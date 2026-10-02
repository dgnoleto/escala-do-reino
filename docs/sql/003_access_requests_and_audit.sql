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

commit;

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
