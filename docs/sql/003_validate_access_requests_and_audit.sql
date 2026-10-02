-- ENSAIO DO INCREMENTO: executar o arquivo inteiro; termina em ROLLBACK.
-- Escala do Reino: incremento de proposta de nome e auditoria.
-- Rascunho: validar com ROLLBACK antes da aplicação permanente.
-- Não concede acesso, cadastra admin ou altera credenciais do Auth.
begin;

do $preflight$
begin
  if current_setting('server_encoding') <> 'UTF8'
     or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'Banco e conexão precisam usar UTF8.';
  end if;
  if to_regclass('app_private.churches') is null
     or to_regclass('app_private.members') is null
     or to_regclass('app_private.church_access') is null
     or to_regclass('app_private.access_invitations') is null
     or to_regprocedure('app_private.touch_updated_at()') is null then
    raise exception 'A estrutura inicial precisa existir antes deste incremento.';
  end if;
  if to_regclass('app_private.access_requests') is not null
     or to_regclass('app_private.audit_entries') is not null then
    raise exception 'Incremento já presente; parar e conferir o estado do banco.';
  end if;
end;
$preflight$;

-- Um convite não consumido/cancelado por membro. Uma linha expirada ainda
-- ocupa a posição; o comando de reemissão precisa finalizá-la na transação.
-- Não usar now() em predicado de índice parcial.
create unique index access_invitations_one_open_per_member
  on app_private.access_invitations(church_id, member_id)
  where redeemed_at is null and revoked_at is null;

-- A solicitação deve pertencer ao mesmo membro, igreja, convite, conta que
-- consumiu o token e prazo original. A FK composta impede referências cruzadas.
alter table app_private.access_invitations
  add constraint invitations_request_reference_unique
  unique (church_id, member_id, id, redeemed_by_user_id, expires_at);

create table app_private.access_requests (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  member_id uuid not null,
  invitation_id uuid not null unique,
  requester_user_id uuid not null references auth.users(id) on delete restrict,
  original_display_name text not null,
  proposed_display_name text not null,
  submitted_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  decided_by_user_id uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint requests_member_fk foreign key (church_id, member_id)
    references app_private.members(church_id, id) on delete restrict,
  constraint requests_consumed_invitation_fk foreign key
    (church_id, member_id, invitation_id, requester_user_id, expires_at)
    references app_private.access_invitations
    (church_id, member_id, id, redeemed_by_user_id, expires_at) on delete restrict,
  constraint requests_original_name_valid check (
    original_display_name = btrim(original_display_name)
    and char_length(original_display_name) between 1 and 120
  ),
  constraint requests_proposed_name_valid check (
    proposed_display_name = btrim(proposed_display_name)
    and char_length(proposed_display_name) between 1 and 120
  ),
  constraint requests_names_differ check (proposed_display_name <> original_display_name),
  constraint requests_submission_before_expiry check (submitted_at < expires_at),
  constraint requests_decision_state check (
    (status = 'pending' and decided_at is null and decided_by_user_id is null)
    or (status in ('approved', 'rejected', 'cancelled')
        and decided_at is not null and decided_by_user_id is not null)
    or (status = 'expired' and decided_at is not null and decided_by_user_id is null)
  ),
  constraint requests_decision_after_submission check (decided_at >= submitted_at),
  constraint requests_approval_before_expiry check (
    status <> 'approved' or decided_at < expires_at
  ),
  constraint requests_expiration_time check (
    status <> 'expired' or decided_at >= expires_at
  )
);

create trigger access_requests_touch_updated_at
before update on app_private.access_requests
for each row execute function app_private.touch_updated_at();

create index requests_church_status_expiry_idx
  on app_private.access_requests(church_id, status, expires_at);
create index requests_church_member_idx
  on app_private.access_requests(church_id, member_id);
create index requests_requester_idx on app_private.access_requests(requester_user_id);
create index requests_decider_idx on app_private.access_requests(decided_by_user_id)
  where decided_by_user_id is not null;

create table app_private.audit_entries (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  action text not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_source text not null check (actor_source in ('application', 'maintenance')),
  maintenance_operator text,
  target_type text not null,
  target_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default statement_timestamp(),
  constraint audit_action_valid check (
    action = btrim(action) and char_length(action) between 1 and 80
  ),
  constraint audit_target_type_valid check (
    target_type = btrim(target_type) and char_length(target_type) between 1 and 80
  ),
  constraint audit_actor_valid check (
    (actor_source = 'application' and actor_user_id is not null and maintenance_operator is null)
    or (actor_source = 'maintenance' and maintenance_operator is not null
        and char_length(btrim(maintenance_operator)) between 1 and 160)
  ),
  constraint audit_details_object check (jsonb_typeof(details) = 'object'),
  constraint audit_details_size check (octet_length(details::text) <= 4096)
);

create index audit_church_time_idx on app_private.audit_entries(church_id, occurred_at desc);
create index audit_target_idx on app_private.audit_entries(church_id, target_type, target_id);
create index audit_actor_idx on app_private.audit_entries(actor_user_id)
  where actor_user_id is not null;

alter table app_private.access_requests enable row level security;
alter table app_private.audit_entries enable row level security;

revoke all on table app_private.access_requests, app_private.audit_entries
  from public, anon, authenticated, service_role;

-- Verificações do incremento; tudo fica na transação desfeita ao final.
do $checks$
declare
  church_test_id uuid;
  table_name text;
  role_name text;
  actual_constraint text;
  expected_failure boolean;
  sample_requester uuid := '00000000-0000-0000-0000-000000000101';
begin
  foreach table_name in array array['access_requests', 'audit_entries'] loop
    if not exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app_private' and c.relname = table_name and c.relkind = 'r' and c.relrowsecurity
    ) then raise exception 'Tabela ausente ou sem RLS: %', table_name; end if;
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      if has_schema_privilege(role_name, 'app_private', 'USAGE')
         or has_schema_privilege(role_name, 'app_private', 'CREATE')
         or has_table_privilege(role_name, 'app_private.' || table_name, 'SELECT')
         or has_table_privilege(role_name, 'app_private.' || table_name, 'INSERT')
         or has_table_privilege(role_name, 'app_private.' || table_name, 'UPDATE')
         or has_table_privilege(role_name, 'app_private.' || table_name, 'DELETE')
         or has_table_privilege(role_name, 'app_private.' || table_name, 'TRUNCATE')
         or has_table_privilege(role_name, 'app_private.' || table_name, 'REFERENCES')
         or has_table_privilege(role_name, 'app_private.' || table_name, 'TRIGGER') then
        raise exception 'Privilégio inesperado para % em %.', role_name, table_name;
      end if;
    end loop;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_policies where schemaname = 'app_private'
      and tablename in ('access_requests', 'audit_entries')
  ) then raise exception 'Este incremento não deve liberar políticas.'; end if;

  insert into app_private.churches(name, timezone, default_duration_policy)
    values ('Teste temporário — João e ação ç', 'America/Sao_Paulo', 'warn') returning id into church_test_id;

  insert into app_private.audit_entries(church_id, action, actor_source, maintenance_operator, target_type, target_id)
    values (church_test_id, 'test.structure', 'maintenance', 'transactional_test_only', 'church', church_test_id);

  expected_failure := false;
  begin
    insert into app_private.audit_entries(church_id, action, actor_source, target_type, target_id)
      values (church_test_id, 'test.structure', 'application', 'church', church_test_id);
  exception when check_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'audit_actor_valid' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'Auditoria de aplicação sem ator foi aceita.'; end if;

  expected_failure := false;
  begin
    insert into app_private.audit_entries(church_id, action, actor_source, maintenance_operator, target_type, target_id, details)
      values (church_test_id, 'test.structure', 'maintenance', 'transactional_test_only', 'church', church_test_id, '[]'::jsonb);
  exception when check_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'audit_details_object' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'Payload de auditoria inválido foi aceito.'; end if;

  -- CHECKs são avaliados antes das FKs. UUIDs fictícios apenas preenchem campos
  -- das entradas que devem ser rejeitadas; não se cadastram usuários no Auth.
  expected_failure := false;
  begin
    insert into app_private.access_requests
      (church_id, member_id, invitation_id, requester_user_id, original_display_name,
       proposed_display_name, submitted_at, expires_at, status, decided_by_user_id, decided_at)
    values (church_test_id, sample_requester, sample_requester, sample_requester,
      'Nome original', 'Nome proposto', '2026-10-02T10:00:00Z', '2026-10-05T10:00:00Z',
      'approved', sample_requester, '2026-10-05T10:00:00Z');
  exception when check_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'requests_approval_before_expiry' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'Aprovação no vencimento foi aceita.'; end if;

  expected_failure := false;
  begin
    insert into app_private.access_requests
      (church_id, member_id, invitation_id, requester_user_id, original_display_name,
       proposed_display_name, submitted_at, expires_at, status, decided_by_user_id, decided_at)
    values (church_test_id, sample_requester, sample_requester, sample_requester,
      'Nome original', 'Nome proposto', '2026-10-02T10:00:00Z', '2026-10-05T10:00:00Z',
      'approved', sample_requester, '2026-10-05T10:00:01Z');
  exception when check_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'requests_approval_before_expiry' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'Aprovação após vencimento foi aceita.'; end if;

  expected_failure := false;
  begin
    insert into app_private.access_requests
      (church_id, member_id, invitation_id, requester_user_id, original_display_name,
       proposed_display_name, submitted_at, expires_at)
    values (church_test_id, sample_requester, sample_requester, sample_requester,
      'Mesmo nome', 'Mesmo nome', '2026-10-02T10:00:00Z', '2026-10-05T10:00:00Z');
  exception when check_violation then
    get stacked diagnostics actual_constraint = constraint_name;
    if actual_constraint <> 'requests_names_differ' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'Solicitação desnecessária com mesmo nome foi aceita.'; end if;

  if exists (
    select 1 from app_private.access_requests where church_id = church_test_id
  ) then raise exception 'Entrada rejeitada deixou solicitação gravada.'; end if;
end;
$checks$;

select 'PASS: incremento validado nesta transação' as validation_result;
rollback;

select case
  when to_regclass('app_private.access_requests') is null
    and to_regclass('app_private.audit_entries') is null
    and to_regclass('app_private.access_invitations_one_open_per_member') is null
    and not exists (select 1 from pg_catalog.pg_constraint
      where conrelid = 'app_private.access_invitations'::regclass
        and conname = 'invitations_request_reference_unique')
    and to_regclass('app_private.churches') is not null
    and to_regclass('app_private.members') is not null
    and to_regclass('app_private.church_access') is not null
    and to_regclass('app_private.access_invitations') is not null
  then 'PASS: incremento ensaiado; alterações desfeitas; estrutura inicial preservada'
  else 'FAIL: verificar estado do banco após o ensaio'
end as validation_result;


-- Os comandos posteriores devem preencher autoria/instantes no servidor,
-- conferir e-mail confirmado e admin atual, serializar pelo membro, validar
-- prazo usando clock_timestamp() após bloqueios e gravar auditoria atomicamente.
-- CHECK de decided_at não impede sozinho um cliente de enviar data antiga.
-- Expiração efetiva é calculada mesmo com status persistido 'pending'; o estado
-- 'expired' é opcional para finalização posterior, sem depender de cron.
-- Rejeição/cancelamento de solicitações e reativação não são comandos liberados.
-- A auditoria não deve receber senhas, tokens, links de recuperação ou dados
-- pessoais desnecessários; o limite JSON não substitui a lista de campos permitidos.
-- target_type/target_id é referência de auditoria validada pelo comando, não FK.
