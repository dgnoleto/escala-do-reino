-- ==============================================================================
-- 023_rehearsal_transactional_body.sql
-- Roteiro de Ensaio Transacional Monossessão dos Candidatos 023a, 023b e 025
-- Ordem Operacional Estrita:
-- 1. Guarda Alvo -> 2. Snapshots Fora da Transação -> 3. BEGIN READ COMMITTED ->
-- 4. Limites de Espera -> 5. DDLs -> 6. Fixtures e Cenários S01-S10 -> 7. ROLLBACK ->
-- 8. Verificação Pós-Rollback (Locks, Catálogo Bidirecional, Contagens, Conteúdo) ->
-- 9. Descarte das Tabelas Temporárias
-- ==============================================================================

\set ON_ERROR_STOP on
\set VERBOSITY verbose

-- ------------------------------------------------------------------------------
-- ETAPA 1: Guarda de Identidade do Banco Alvo, OID e Cluster (Antes de qualquer escrita)
-- ------------------------------------------------------------------------------
do $guard_preflight$
declare
  v_db_oid oid;
  v_sys_id text;
begin
  if current_database() <> 'escala_rehearsal_024' then
    raise exception 'PREFLIGHT FALHOU: Banco conectado "%" diverge do alvo esperado "escala_rehearsal_024".',
      current_database() using errcode = 'P0002';
  end if;

  select d.oid into v_db_oid from pg_database d where d.datname = current_database();
  if v_db_oid is distinct from 198690::oid then
    raise exception 'PREFLIGHT FALHOU: OID do banco diverge (esperado 198690, obtido %).',
      v_db_oid using errcode = 'P0002';
  end if;

  select c.system_identifier::text into v_sys_id from pg_control_system() c;
  if v_sys_id is distinct from '7695064938894594085' then
    raise exception 'PREFLIGHT FALHOU: system_identifier do cluster diverge do laboratório esperado (obtido %).',
      v_sys_id using errcode = 'P0002';
  end if;

  raise notice 'REHEARSAL_PREFLIGHT_TARGET_OK';
end;
$guard_preflight$;

-- ------------------------------------------------------------------------------
-- ETAPA 2: Snapshot Anterior de Metadados e Conteúdo (Fora da Transação do Ensaio)
-- Tabelas temporárias criadas na sessão sobrevivem ao ROLLBACK subsequente
-- ------------------------------------------------------------------------------
create temp table pre_rehearsal_catalog_snapshot on commit preserve rows as
select 
  'table'::text as obj_type,
  table_schema::text as s_name,
  table_name::text as o_name,
  null::text as specific_signature
from information_schema.tables
where table_schema in ('public', 'app_private')
union all
select 
  'routine'::text as obj_type,
  routine_schema::text as s_name,
  routine_name::text as o_name,
  specific_name::text as specific_signature
from information_schema.routines
where routine_schema in ('public', 'app_private')
union all
select 
  'column'::text as obj_type,
  table_schema::text as s_name,
  table_name || '.' || column_name as o_name,
  data_type::text as specific_signature
from information_schema.columns
where table_schema = 'app_private' and table_name = 'events';

-- Snapshot de contagens exatas das tabelas de domínio
create temp table pre_rehearsal_row_counts on commit preserve rows as
select 'auth.users'::text as tbl, count(*)::bigint as cnt from auth.users
union all select 'app_private.churches', count(*)::bigint from app_private.churches
union all select 'app_private.members', count(*)::bigint from app_private.members
union all select 'app_private.church_access', count(*)::bigint from app_private.church_access
union all select 'app_private.teams', count(*)::bigint from app_private.teams
union all select 'app_private.events', count(*)::bigint from app_private.events
union all select 'app_private.event_items', count(*)::bigint from app_private.event_items
union all select 'app_private.audit_entries', count(*)::bigint from app_private.audit_entries;

-- Snapshot de conteúdo delimitado de eventos pré-existentes (verificação de ausência de mutações)
create temp table pre_rehearsal_events_content on commit preserve rows as
select 
  id,
  church_id,
  title,
  event_type,
  timezone,
  status,
  planned_start_at,
  planned_end_at,
  liturgy_leader_member_id,
  version
from app_private.events;

-- ------------------------------------------------------------------------------
-- ETAPA 3: Abertura da Transação Única em Isolamento READ COMMITTED
-- ------------------------------------------------------------------------------
begin transaction isolation level read committed;

-- ------------------------------------------------------------------------------
-- ETAPA 4: Limites de Espera (Timeouts Canônicos da Transação)
-- ------------------------------------------------------------------------------
set local lock_timeout = '2s';
set local statement_timeout = '5s';

-- Guarda de concorrência ativa e ausência prévia de recibos
do $isolation_preflight$
declare
  v_other_sessions integer;
begin
  select count(*) into v_other_sessions
  from pg_stat_activity
  where datname = current_database() and pid <> pg_backend_pid();

  if v_other_sessions > 0 then
    raise exception 'PREFLIGHT FALHOU: Detectadas % sessões concorrentes conectadas no banco alvo.',
      v_other_sessions using errcode = '55P03';
  end if;

  if to_regclass('app_private.event_planning_receipts') is not null then
    raise exception 'PREFLIGHT FALHOU: Tabela app_private.event_planning_receipts já preexiste.'
      using errcode = '42P07';
  end if;

  raise notice 'REHEARSAL_PREFLIGHT_ISOLATION_OK';
end;
$isolation_preflight$;

-- ------------------------------------------------------------------------------
-- ETAPA 5: Ponto de Injeção dos Candidatos Aprovados (023a, 023b, 025)
-- ------------------------------------------------------------------------------
__CANDIDATES_INJECTION_POINT__

-- ------------------------------------------------------------------------------
-- ETAPA 6: Fixtures Canônicas e Execução dos Cenários S01 a S10
-- ------------------------------------------------------------------------------
do $scenarios_rehearsal$
declare
  -- Identificadores fictícios hexadecimais estritos (RFC 4122)
  c_church_id     constant uuid := 'c0000000-0000-0000-0000-000000000001';
  c_u_admin       constant uuid := 'a0000000-0000-0000-0000-000000000001';
  c_u_ministerial constant uuid := 'a0000000-0000-0000-0000-000000000002';
  c_u_common      constant uuid := 'a0000000-0000-0000-0000-000000000003';
  c_u_inactive    constant uuid := 'a0000000-0000-0000-0000-000000000004';

  c_m_admin       constant uuid := 'b0000000-0000-0000-0000-000000000001';
  c_m_ministerial constant uuid := 'b0000000-0000-0000-0000-000000000002';
  c_m_common      constant uuid := 'b0000000-0000-0000-0000-000000000003';
  c_m_inactive    constant uuid := 'b0000000-0000-0000-0000-000000000004';

  c_team_id       constant uuid := 'd0000000-0000-0000-0000-000000000001';
  c_item_1_id     constant uuid := 'e0000000-0000-0000-0000-000000000001';
  c_item_2_id     constant uuid := 'e0000000-0000-0000-0000-000000000002';

  -- Variáveis de controle de comandos e validações
  v_cmd_id_admin  constant uuid := '00000000-0000-0000-0000-000000000001';
  v_cmd_id_min    constant uuid := '00000000-0000-0000-0000-000000000002';
  v_cmd_id_pub    constant uuid := '00000000-0000-0000-0000-000000000003';

  v_event_id      uuid;
  v_event_id_min  uuid;
  v_passed        boolean;
  v_base_version   integer;
  v_rec_result     jsonb;
  v_orig_record    record;
  v_rep_record     record;
  v_policy_val     text;
  v_prog_status    text;
  v_event_status   text;
  v_version_val    integer;
  v_published_at   timestamptz;
  v_published_by_member_id uuid;
  v_audit_count    integer;
  v_orders         integer[];
  v_now            timestamptz := clock_timestamp();

  -- Variáveis delimitadas de estado pré/pós para S05, S06 e S10
  v_s05_events_cnt   integer;
  v_s05_rcpts_cnt    integer;
  v_s05_audits_cnt   integer;
  v_s05_event_before jsonb;
  v_s05_rcpt_before  jsonb;
  v_s05_audit_before jsonb;

  v_s06_events_cnt   integer;
  v_s06_rcpts_cnt    integer;
  v_s06_audits_cnt   integer;
  v_s06_event_before jsonb;
  v_s06_rcpt_before  jsonb;
  v_s06_audit_before jsonb;

  v_s10_events_cnt    integer;
  v_s10_rcpts_cnt     integer;
  v_s10_audits_cnt    integer;
  v_s10_event1_before jsonb;
  v_s10_event2_before jsonb;
  v_s10_rcpt_before   jsonb;
  v_s10_audit_before  jsonb;
begin
  -- ----------------------------------------------------------------------------
  -- 6.1 Guarda contra Colisão Prévia de Identificadores
  -- ----------------------------------------------------------------------------
  if exists (select 1 from auth.users where id in (c_u_admin, c_u_ministerial, c_u_common, c_u_inactive))
     or exists (select 1 from app_private.churches where id = c_church_id)
     or exists (select 1 from app_private.members where id in (c_m_admin, c_m_ministerial, c_m_common, c_m_inactive))
     or exists (select 1 from app_private.teams where id = c_team_id)
     or exists (select 1 from app_private.event_items where id in (c_item_1_id, c_item_2_id)) then
    raise exception 'COLISÃO DETECTADA: Identificadores fixos de fixtures já constam no banco.'
      using errcode = '23505';
  end if;

  -- ----------------------------------------------------------------------------
  -- 6.2 Instalação de Fixtures Canônicas (sob role postgres)
  -- ----------------------------------------------------------------------------
  reset role;

  -- auth.users (elegíveis, confirmados e não banidos)
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at
  ) values
    (c_u_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@rehearsal.local', v_now, '{"provider":"email"}'::jsonb, '{}'::jsonb, false, v_now, v_now),
    (c_u_ministerial, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lider@rehearsal.local', v_now, '{"provider":"email"}'::jsonb, '{}'::jsonb, false, v_now, v_now),
    (c_u_common, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'comum@rehearsal.local', v_now, '{"provider":"email"}'::jsonb, '{}'::jsonb, false, v_now, v_now),
    (c_u_inactive, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inativo@rehearsal.local', v_now, '{"provider":"email"}'::jsonb, '{}'::jsonb, false, v_now, v_now);

  -- app_private.churches (esquema canônico completo)
  insert into app_private.churches (
    id, name, timezone, default_duration_policy, status, created_at, updated_at
  ) values (
    c_church_id, 'Igreja Ensaio R7 Canônica', 'America/Sao_Paulo', 'warn', 'active', v_now, v_now
  );

  -- app_private.members (display_name e created_by_user_id canônicos)
  insert into app_private.members (
    id, church_id, display_name, status, created_by_user_id, created_at, updated_at
  ) values
    (c_m_admin, c_church_id, 'Membro Admin', 'active', c_u_admin, v_now, v_now),
    (c_m_ministerial, c_church_id, 'Membro Líder Ministerial', 'active', c_u_admin, v_now, v_now),
    (c_m_common, c_church_id, 'Membro Comum', 'active', c_u_admin, v_now, v_now),
    (c_m_inactive, c_church_id, 'Membro Inativo Teste', 'inactive', c_u_admin, v_now, v_now);

  -- app_private.church_access (linha revoked com campos obrigatórios preenchidos)
  insert into app_private.church_access (
    church_id, user_id, member_id, status, is_admin, onboarding_completed_at,
    granted_by_user_id, granted_at, revoked_by_user_id, revoked_at
  ) values
    (c_church_id, c_u_admin, c_m_admin, 'active', true, v_now, c_u_admin, v_now, null, null),
    (c_church_id, c_u_ministerial, c_m_ministerial, 'active', false, v_now, c_u_admin, v_now, null, null),
    (c_church_id, c_u_common, c_m_common, 'active', false, v_now, c_u_admin, v_now, null, null),
    (c_church_id, c_u_inactive, c_m_inactive, 'revoked', false, null, c_u_admin, v_now, c_u_admin, v_now);

  -- app_private.teams (equipe litúrgica com líder ministerial)
  insert into app_private.teams (
    id, church_id, name, leader_member_id, status, version, created_at, updated_at
  ) values (
    c_team_id, c_church_id, 'Ministério de Liturgia Ensaio', c_m_ministerial, 'active', 1, v_now, v_now
  );

  -- ----------------------------------------------------------------------------
  -- CENÁRIO S01: Não-administrador tentando designar dirigente litúrgico -> Erro 42501
  -- ----------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_u_common::text, true);
  v_passed := false;

  begin
    perform public.create_church_event_edition(
      c_church_id, gen_random_uuid(), 'Culto S01 Recusa', 'culto',
      v_now + interval '1 day', v_now + interval '1 day 2 hours',
      c_m_ministerial, 'warn'
    );
  exception when sqlstate '42501' then
    v_passed := true;
  end;

  if not v_passed then
    raise exception 'S01 FALHOU: Chamador comum designou dirigente ou SQLSTATE divergiu de 42501.' using errcode = 'P0001';
  end if;

  reset role;
  if exists (select 1 from app_private.events where church_id = c_church_id) then
    raise exception 'S01 FALHOU: Efeito residual criado em events após recusa 42501.' using errcode = 'P0001';
  end if;
  raise notice 'REHEARSAL_S01_OK';

  -- ----------------------------------------------------------------------------
  -- CENÁRIO S02: Administrador designando membro inativo como dirigente -> Erro 23503
  -- ----------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_u_admin::text, true);
  v_passed := false;

  begin
    perform public.create_church_event_edition(
      c_church_id, gen_random_uuid(), 'Culto S02 Inativo', 'culto',
      v_now + interval '1 day', v_now + interval '1 day 2 hours',
      c_m_inactive, 'warn'
    );
  exception when sqlstate '23503' then
    v_passed := true;
  end;

  if not v_passed then
    raise exception 'S02 FALHOU: Designação de dirigente inativo não foi rejeitada com 23503.' using errcode = 'P0001';
  end if;

  reset role;
  if exists (select 1 from app_private.events where church_id = c_church_id) then
    raise exception 'S02 FALHOU: Efeito residual criado em events após recusa 23503.' using errcode = 'P0001';
  end if;
  raise notice 'REHEARSAL_S02_OK';

  -- ----------------------------------------------------------------------------
  -- CENÁRIO S03: Administrador criando edição autorizada com dirigente ativo -> Sucesso
  -- ----------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_u_admin::text, true);

  select * into v_orig_record
  from public.create_church_event_edition(
    c_church_id, v_cmd_id_admin, 'Culto S03 Principal', 'culto',
    v_now + interval '2 days', v_now + interval '2 days 2 hours',
    c_m_ministerial, 'warn'
  );

  v_event_id := v_orig_record.result_entity_id;

  if v_event_id is null
     or v_orig_record.command_id is distinct from v_cmd_id_admin
     or v_orig_record.action is distinct from 'create_church_event_edition'
     or v_orig_record.church_id is distinct from c_church_id
     or v_orig_record.result_payload is null
     or v_orig_record.created_at is null then
    raise exception 'S03 FALHOU: Retorno contratual de create_church_event_edition inválido ou incompleto.'
      using errcode = 'P0001';
  end if;

  reset role;
  select result into v_rec_result
  from app_private.event_planning_receipts
  where church_id = c_church_id and command_id = v_cmd_id_admin;

  if v_rec_result is null or (v_rec_result->>'event_id')::uuid is distinct from v_event_id then
    raise exception 'S03 FALHOU: Recibo de criação não gravado ou divergente do evento criado.' using errcode = 'P0001';
  end if;

  -- Conferência de status ('scheduled' e 'draft') e versão inicial ('1') prometidos
  select status, program_status, program_version into v_event_status, v_prog_status, v_version_val
  from app_private.events where id = v_event_id and liturgy_leader_member_id = c_m_ministerial;

  if v_event_status is distinct from 'scheduled'
     or v_prog_status is distinct from 'draft'
     or v_version_val is distinct from 1 then
    raise exception 'S03 FALHOU: Distinção de status ou versão inicial violada (status %, program_status %, versão %).',
      v_event_status, v_prog_status, v_version_val using errcode = 'P0001';
  end if;

  -- Verificação da auditoria de criação prometida
  select count(*) into v_audit_count
  from app_private.audit_entries
  where church_id = c_church_id
    and action = 'create_church_event_edition'
    and target_type = 'events'
    and target_id = v_event_id
    and actor_user_id = c_u_admin;

  if v_audit_count <> 1 then
    raise exception 'S03 FALHOU: Registro de auditoria de criação não encontrado ou divergente (obtido %).',
      v_audit_count using errcode = 'P0001';
  end if;
  raise notice 'REHEARSAL_S03_OK';

  -- ----------------------------------------------------------------------------
  -- CENÁRIO S04: Líder ministerial ativo cria evento sem dirigente -> Sucesso (Opção B)
  -- ----------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_u_ministerial::text, true);

  select result_entity_id into v_event_id_min
  from public.create_church_event_edition(
    c_church_id, v_cmd_id_min, 'Culto S04 Líder Ministerial', 'culto',
    v_now + interval '3 days', v_now + interval '3 days 2 hours',
    null, 'warn'
  );

  if v_event_id_min is null then
    raise exception 'S04 FALHOU: Líder ministerial ativo foi impedido de criar evento sem dirigente.' using errcode = 'P0001';
  end if;

  reset role;
  if not exists (
    select 1 from app_private.events
    where id = v_event_id_min and liturgy_leader_member_id is null and program_status = 'draft'
  ) then
    raise exception 'S04 FALHOU: Evento de líder ministerial criado com dirigente indevido ou status incorreto.' using errcode = 'P0001';
  end if;
  raise notice 'REHEARSAL_S04_OK';

  -- ----------------------------------------------------------------------------
  -- CENÁRIO S05: Idempotência de Replay Exato sob Mesma Autoridade -> Sucesso
  -- ----------------------------------------------------------------------------
  reset role;
  -- Captura delimitada de contagens e conteúdo relevante pré-replay
  select count(*) into v_s05_events_cnt from app_private.events where church_id = c_church_id;
  select count(*) into v_s05_rcpts_cnt  from app_private.event_planning_receipts where church_id = c_church_id;
  select count(*) into v_s05_audits_cnt from app_private.audit_entries where church_id = c_church_id;

  select to_jsonb(e.*) into v_s05_event_before from app_private.events e where e.id = v_event_id;
  select to_jsonb(r.*) into v_s05_rcpt_before from app_private.event_planning_receipts r
    where r.church_id = c_church_id and r.command_id = v_cmd_id_admin;
  select jsonb_agg(to_jsonb(a.*) order by a.occurred_at, a.id) into v_s05_audit_before from app_private.audit_entries a
    where a.church_id = c_church_id and a.target_id = v_event_id;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_u_admin::text, true);

  select * into v_rep_record
  from public.create_church_event_edition(
    c_church_id, v_cmd_id_admin, 'Culto S03 Principal', 'culto',
    v_now + interval '2 days', v_now + interval '2 days 2 hours',
    c_m_ministerial, 'warn'
  );

  -- Confronto exato de todos os 6 campos contratuais entre original (S03) e replay
  if v_rep_record.command_id is distinct from v_orig_record.command_id
     or v_rep_record.action is distinct from v_orig_record.action
     or v_rep_record.church_id is distinct from v_orig_record.church_id
     or v_rep_record.result_entity_id is distinct from v_orig_record.result_entity_id
     or v_rep_record.result_payload is distinct from v_orig_record.result_payload
     or v_rep_record.created_at is distinct from v_orig_record.created_at then
    raise exception 'S05 FALHOU: Retorno do replay exato diverge do retorno original de S03 em seus campos contratuais.'
      using errcode = 'P0001';
  end if;

  reset role;
  -- Verificação de ausência de novas escritas (contagens delimitadas)
  if (select count(*) from app_private.events where church_id = c_church_id) <> v_s05_events_cnt
     or (select count(*) from app_private.event_planning_receipts where church_id = c_church_id) <> v_s05_rcpts_cnt
     or (select count(*) from app_private.audit_entries where church_id = c_church_id) <> v_s05_audits_cnt then
    raise exception 'S05 FALHOU: Replay idempotente gerou novas escritas nas tabelas delimitadas.' using errcode = 'P0001';
  end if;

  -- Verificação de ausência de alterações de conteúdo relevante em events, recibos e auditoria
  if (select to_jsonb(e.*) from app_private.events e where e.id = v_event_id) is distinct from v_s05_event_before
     or (select to_jsonb(r.*) from app_private.event_planning_receipts r where r.church_id = c_church_id and r.command_id = v_cmd_id_admin) is distinct from v_s05_rcpt_before
     or (select jsonb_agg(to_jsonb(a.*) order by a.occurred_at, a.id) from app_private.audit_entries a where a.church_id = c_church_id and a.target_id = v_event_id) is distinct from v_s05_audit_before then
    raise exception 'S05 FALHOU: Replay idempotente causou mutação no conteúdo relevante de eventos, recibos ou auditoria.'
      using errcode = 'P0001';
  end if;
  raise notice 'REHEARSAL_S05_OK';

  -- ----------------------------------------------------------------------------
  -- CENÁRIO S06: Recusa de Replay após Perda da Autoridade Ministerial -> Erro 42501
  -- ----------------------------------------------------------------------------
  reset role;

  -- 1. Preparação: inativa a equipe qualificadora de c_u_ministerial
  update app_private.teams set status = 'inactive' where id = c_team_id;

  -- 2. Captura do estado de referência DEPOIS da inativação e ANTES do replay
  select count(*) into v_s06_events_cnt from app_private.events where church_id = c_church_id;
  select count(*) into v_s06_rcpts_cnt  from app_private.event_planning_receipts where church_id = c_church_id;
  select count(*) into v_s06_audits_cnt from app_private.audit_entries where church_id = c_church_id;

  select to_jsonb(e.*) into v_s06_event_before from app_private.events e where e.id = v_event_id_min;
  select to_jsonb(r.*) into v_s06_rcpt_before from app_private.event_planning_receipts r
    where r.church_id = c_church_id and r.command_id = v_cmd_id_min;
  select jsonb_agg(to_jsonb(a.*) order by a.occurred_at, a.id) into v_s06_audit_before from app_private.audit_entries a
    where a.church_id = c_church_id and a.target_id = v_event_id_min;

  -- 3. Execução do replay recusado sob c_u_ministerial (espera-se 42501)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_u_ministerial::text, true);
  v_passed := false;

  begin
    perform public.create_church_event_edition(
      c_church_id, v_cmd_id_min, 'Culto S04 Líder Ministerial', 'culto',
      v_now + interval '3 days', v_now + interval '3 days 2 hours',
      null, 'warn'
    );
  exception when sqlstate '42501' then
    v_passed := true;
  end;

  if not v_passed then
    raise exception 'S06 FALHOU: Replay após perda de autoridade não foi barrado com 42501.' using errcode = 'P0001';
  end if;

  -- 4. Verificação de ausência de efeitos atribuídos à RPC no conjunto delimitado
  reset role;
  if (select count(*) from app_private.events where church_id = c_church_id) <> v_s06_events_cnt
     or (select count(*) from app_private.event_planning_receipts where church_id = c_church_id) <> v_s06_rcpts_cnt
     or (select count(*) from app_private.audit_entries where church_id = c_church_id) <> v_s06_audits_cnt then
    raise exception 'S06 FALHOU: Replay recusado gerou novas escritas no conjunto delimitado.' using errcode = 'P0001';
  end if;

  if (select to_jsonb(e.*) from app_private.events e where e.id = v_event_id_min) is distinct from v_s06_event_before
     or (select to_jsonb(r.*) from app_private.event_planning_receipts r where r.church_id = c_church_id and r.command_id = v_cmd_id_min) is distinct from v_s06_rcpt_before
     or (select jsonb_agg(to_jsonb(a.*) order by a.occurred_at, a.id) from app_private.audit_entries a where a.church_id = c_church_id and a.target_id = v_event_id_min) is distinct from v_s06_audit_before then
    raise exception 'S06 FALHOU: Chamada recusada com 42501 causou mutação no conjunto delimitado de eventos, recibos ou auditoria.'
      using errcode = 'P0001';
  end if;

  -- 5. Reativação da equipe ministerial (preparação para os cenários seguintes)
  update app_private.teams set status = 'active' where id = c_team_id;
  raise notice 'REHEARSAL_S06_OK';

  -- ----------------------------------------------------------------------------
  -- CENÁRIO S07: set_event_duration_policy ('strict' rejeitado 22000 / 'block' aceito)
  -- ----------------------------------------------------------------------------
  -- Chamador: c_u_ministerial (dirigente litúrgico do evento v_event_id)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_u_ministerial::text, true);
  v_passed := false;

  begin
    perform public.set_event_duration_policy(c_church_id, gen_random_uuid(), v_event_id, 'strict');
  exception when sqlstate '22000' then
    v_passed := true;
  end;

  if not v_passed then
    raise exception 'S07 FALHOU: Política "strict" não foi rejeitada com 22000.' using errcode = 'P0001';
  end if;

  perform public.set_event_duration_policy(c_church_id, gen_random_uuid(), v_event_id, 'block');

  reset role;
  select duration_policy into v_policy_val from app_private.events where id = v_event_id;
  if v_policy_val is distinct from 'block' then
    raise exception 'S07 FALHOU: duration_policy não foi atualizada para "block" (obtido %).', v_policy_val using errcode = 'P0001';
  end if;
  raise notice 'REHEARSAL_S07_OK';

  -- ----------------------------------------------------------------------------
  -- CENÁRIO S08: reorder_event_items com evento bloqueado FOR UPDATE -> Sucesso
  -- ----------------------------------------------------------------------------
  reset role;
  insert into app_private.event_items (
    id, church_id, event_id, title, item_nature, sequence_order, planned_duration_seconds, status
  ) values
    (c_item_1_id, c_church_id, v_event_id, 'Abertura e Louvor', 'liturgical', 1, 300, 'pending'),
    (c_item_2_id, c_church_id, v_event_id, 'Mensagem Pastoral', 'liturgical', 2, 600, 'pending');

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_u_ministerial::text, true);

  -- Reordena invertendo os itens para [2, 1]
  perform public.reorder_event_items(c_church_id, gen_random_uuid(), v_event_id, array[c_item_2_id, c_item_1_id]);

  reset role;
  select array_agg(sequence_order order by id asc) into v_orders
  from app_private.event_items where id in (c_item_1_id, c_item_2_id);

  if v_orders is distinct from array[2, 1] then
    raise exception 'S08 FALHOU: Reordenação divergente do array esperado (obtido %).', v_orders using errcode = 'P0001';
  end if;
  raise notice 'REHEARSAL_S08_OK';

  -- ----------------------------------------------------------------------------
  -- CENÁRIO S09: save_event_program_draft e publish_event_program (Versão Exata)
  -- ----------------------------------------------------------------------------
  reset role;
  select program_version into v_base_version from app_private.events where id = v_event_id;

  -- 1. Salvar Rascunho separadamente (mantém versão inalterada e events.status = 'scheduled')
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_u_ministerial::text, true);
  perform public.save_event_program_draft(c_church_id, gen_random_uuid(), v_event_id);

  reset role;
  select status, program_status, program_version into v_event_status, v_prog_status, v_version_val
  from app_private.events where id = v_event_id;

  if v_event_status is distinct from 'scheduled'
     or v_prog_status is distinct from 'draft'
     or v_version_val is distinct from v_base_version then
    raise exception 'S09 (Rascunho) FALHOU: Rascunho alterou status geral, status do programa ou versão (status %, program_status %, versão %, base %).',
      v_event_status, v_prog_status, v_version_val, v_base_version using errcode = 'P0001';
  end if;

  -- 2. Publicar Programa (duração ocupada 900s <= 7200s planejados; compatível com 'block')
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_u_ministerial::text, true);
  perform public.publish_event_program(c_church_id, v_cmd_id_pub, v_event_id);

  reset role;
  select status, program_status, program_version, published_at, published_by_member_id
  into v_event_status, v_prog_status, v_version_val, v_published_at, v_published_by_member_id
  from app_private.events where id = v_event_id;

  if v_event_status is distinct from 'scheduled'
     or v_prog_status is distinct from 'published'
     or v_version_val is distinct from (v_base_version + 1)
     or v_published_at is null
     or v_published_by_member_id is distinct from c_m_ministerial then
    raise exception 'S09 (Publicação) FALHOU: Falha na preservação de events.status, incremento de versão ou metadados de publicação (status %, program_status %, versão %).',
      v_event_status, v_prog_status, v_version_val using errcode = 'P0001';
  end if;
  raise notice 'REHEARSAL_S09_OK';

  -- ----------------------------------------------------------------------------
  -- CENÁRIO S10: Idempotência de Conflito em Publicação -> Erro 23505
  -- ----------------------------------------------------------------------------
  reset role;
  select count(*) into v_s10_events_cnt from app_private.events where church_id = c_church_id;
  select count(*) into v_s10_rcpts_cnt  from app_private.event_planning_receipts where church_id = c_church_id;
  select count(*) into v_s10_audits_cnt from app_private.audit_entries where church_id = c_church_id;

  select to_jsonb(e.*) into v_s10_event1_before from app_private.events e where e.id = v_event_id;
  select to_jsonb(e.*) into v_s10_event2_before from app_private.events e where e.id = v_event_id_min;
  select to_jsonb(r.*) into v_s10_rcpt_before from app_private.event_planning_receipts r
    where r.church_id = c_church_id and r.command_id = v_cmd_id_pub;
  select jsonb_agg(to_jsonb(a.*) order by a.occurred_at, a.id) into v_s10_audit_before from app_private.audit_entries a
    where a.church_id = c_church_id and a.target_id in (v_event_id, v_event_id_min);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', c_u_ministerial::text, true);
  v_passed := false;

  begin
    -- Reutiliza v_cmd_id_pub associado a v_event_id tentando aplicar em v_event_id_min
    perform public.publish_event_program(c_church_id, v_cmd_id_pub, v_event_id_min);
  exception when sqlstate '23505' then
    v_passed := true;
  end;

  if not v_passed then
    raise exception 'S10 FALHOU: Idempotência de conflito não rejeitou command_id reutilizado com 23505.' using errcode = 'P0001';
  end if;

  reset role;
  if (select count(*) from app_private.events where church_id = c_church_id) <> v_s10_events_cnt
     or (select count(*) from app_private.event_planning_receipts where church_id = c_church_id) <> v_s10_rcpts_cnt
     or (select count(*) from app_private.audit_entries where church_id = c_church_id) <> v_s10_audits_cnt then
    raise exception 'S10 FALHOU: Chamada conflitante 23505 produziu novas escritas no conjunto delimitado.' using errcode = 'P0001';
  end if;

  if (select to_jsonb(e.*) from app_private.events e where e.id = v_event_id) is distinct from v_s10_event1_before
     or (select to_jsonb(e.*) from app_private.events e where e.id = v_event_id_min) is distinct from v_s10_event2_before
     or (select to_jsonb(r.*) from app_private.event_planning_receipts r where r.church_id = c_church_id and r.command_id = v_cmd_id_pub) is distinct from v_s10_rcpt_before
     or (select jsonb_agg(to_jsonb(a.*) order by a.occurred_at, a.id) from app_private.audit_entries a where a.church_id = c_church_id and a.target_id in (v_event_id, v_event_id_min)) is distinct from v_s10_audit_before then
    raise exception 'S10 FALHOU: Chamada conflitante rejeitada com 23505 causou mutações indevidas nos eventos envolvidos, recibos ou auditoria.'
      using errcode = 'P0001';
  end if;

  raise notice 'REHEARSAL_S10_OK';
end;
$scenarios_rehearsal$;

-- ------------------------------------------------------------------------------
-- ETAPA 7: Reversão Transacional Incondicional (ROLLBACK)
-- ------------------------------------------------------------------------------
reset role;
rollback;

do $$
begin
  raise notice 'REHEARSAL_ROLLBACK_CONFIRMED';
end;
$$;

-- ------------------------------------------------------------------------------
-- ETAPA 8: Verificações Posteriores na Mesma Conexão Pós-Rollback
-- ------------------------------------------------------------------------------

-- 8.1 Verificação de Advisory Locks da Própria Sessão Pós-Rollback
do $assert_session_locks$
declare
  v_session_advisory_locks integer;
begin
  select count(*) into v_session_advisory_locks
  from pg_locks
  where locktype = 'advisory' and pid = pg_backend_pid();

  if v_session_advisory_locks is distinct from 0 then
    raise exception 'FALHA PÓS-ROLLBACK: Sessão reteve % advisory locks após rollback.',
      v_session_advisory_locks using errcode = 'P0001';
  end if;

  raise notice 'POST_ROLLBACK_ADVISORY_LOCKS_ZERO';
end;
$assert_session_locks$;

-- 8.2 Comparação Bidirecional de Catálogo com o Snapshot Pré-Ensaio
do $assert_bidirectional_catalog$
declare
  v_added_objects integer;
  v_dropped_objects integer;
begin
  -- Objetos adicionados e não desfeitos pelo rollback
  select count(*) into v_added_objects from (
    select 'table'::text as obj_type, table_schema::text as s_name, table_name::text as o_name, null::text as specific_signature
    from information_schema.tables where table_schema in ('public', 'app_private')
    union all
    select 'routine', routine_schema, routine_name, specific_name
    from information_schema.routines where routine_schema in ('public', 'app_private')
    union all
    select 'column', table_schema, table_name || '.' || column_name, data_type
    from information_schema.columns where table_schema = 'app_private' and table_name = 'events'
    except
    select obj_type, s_name, o_name, specific_signature from pre_rehearsal_catalog_snapshot
  ) a;

  -- Objetos pré-existentes suprimidos indevidamente
  select count(*) into v_dropped_objects from (
    select obj_type, s_name, o_name, specific_signature from pre_rehearsal_catalog_snapshot
    except
    (
      select 'table'::text, table_schema::text, table_name::text, null::text
      from information_schema.tables where table_schema in ('public', 'app_private')
      union all
      select 'routine', routine_schema, routine_name, specific_name
      from information_schema.routines where routine_schema in ('public', 'app_private')
      union all
      select 'column', table_schema, table_name || '.' || column_name, data_type
      from information_schema.columns where table_schema = 'app_private' and table_name = 'events'
    )
  ) d;

  if v_added_objects is distinct from 0 or v_dropped_objects is distinct from 0 then
    raise exception 'FALHA PÓS-ROLLBACK: Delta de catálogo não nulo (adicionados: %, suprimidos: %).',
      v_added_objects, v_dropped_objects using errcode = 'P0001';
  end if;

  raise notice 'POST_ROLLBACK_CATALOG_DELTA_ZERO';
end;
$assert_bidirectional_catalog$;

-- 8.3 Comparação de Contagens de Linhas das Tabelas de Domínio
do $assert_row_counts$
begin
  if exists (
    select 1
    from (
      select 'auth.users'::text as tbl, count(*)::bigint as cnt from auth.users
      union all select 'app_private.churches', count(*)::bigint from app_private.churches
      union all select 'app_private.members', count(*)::bigint from app_private.members
      union all select 'app_private.church_access', count(*)::bigint from app_private.church_access
      union all select 'app_private.teams', count(*)::bigint from app_private.teams
      union all select 'app_private.events', count(*)::bigint from app_private.events
      union all select 'app_private.event_items', count(*)::bigint from app_private.event_items
      union all select 'app_private.audit_entries', count(*)::bigint from app_private.audit_entries
    ) curr
    join pre_rehearsal_row_counts pre on curr.tbl = pre.tbl
    where curr.cnt is distinct from pre.cnt
  ) then
    raise exception 'FALHA PÓS-ROLLBACK: Contagem de linhas diverge do snapshot prévio.' using errcode = 'P0001';
  end if;

  raise notice 'POST_ROLLBACK_ROW_COUNTS_DELTA_ZERO';
end;
$assert_row_counts$;

-- 8.4 Comparação Delimitada de Conteúdo e Atributos de Linhas de Eventos Pré-existentes
do $assert_events_content$
declare
  v_mutations_count integer;
begin
  select count(*) into v_mutations_count
  from (
    select id, church_id, title, event_type, timezone, status, planned_start_at, planned_end_at, liturgy_leader_member_id, version
    from app_private.events
    except
    select id, church_id, title, event_type, timezone, status, planned_start_at, planned_end_at, liturgy_leader_member_id, version
    from pre_rehearsal_events_content
  ) diff;

  if v_mutations_count is distinct from 0 then
    raise exception 'FALHA PÓS-ROLLBACK: Detectada mutação em % eventos pré-existentes.',
      v_mutations_count using errcode = 'P0001';
  end if;

  raise notice 'POST_ROLLBACK_CONTENT_ATTRIBUTES_DELTA_ZERO';
end;
$assert_events_content$;

-- ------------------------------------------------------------------------------
-- ETAPA 9: Descarte das Tabelas Temporárias de Sessão
-- ------------------------------------------------------------------------------
drop table pre_rehearsal_catalog_snapshot;
drop table pre_rehearsal_row_counts;
drop table pre_rehearsal_events_content;
