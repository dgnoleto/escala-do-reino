-- ==============================================================================
-- 023a_event_planning_structural.sql
-- Candidato Estrutural DDL: Planejamento Litúrgico e Recibos de Idempotência
--
-- Rastreabilidade: Issues #28, #29, #30 e #58
-- Decisão do Responsável: https://github.com/dgnoleto/escala-do-reino/issues/58#issuecomment-6386407831
-- Auditoria Independente: Parecer Técnico Codex (Aprovado Estaticamente)
--
-- ESCOPO EXCLUSIVO DESTE ARTEFATO:
-- Extração estritamente estrutural (DDL) do SQL 023 original:
--   1. Validação de preflight da presença das estruturas fundamentais (001–015)
--   2. Evolução da tabela app_private.events (5 colunas e constraints de planejamento)
--   3. Criação da tabela app_private.event_planning_receipts com PK (user_id, command_id)
--   4. Configuração de RLS e revogação de privilégios públicos/diretos
--   5. Asserções pós-instalação da presença das colunas e tabela
--
-- DIRETRIZES DE GOVERNANÇA E CONTROLE TRANSACIONAL:
-- - Este arquivo NÃO embute BEGIN ou COMMIT internos, assegurando total controle
--   ao wrapper / executor para ensaios reversíveis sob ROLLBACK ou composição
--   atômica com os componentes 023b e 025.
-- - NÃO incorpora a RPC de criação original (insegura), que é substituída pelo candidato 023b.
-- - NÃO incorpora as 4 RPCs de planejamento/duração, que são supridas com segurança pelo SQL 025.
-- - NÃO contém comando NOTIFY (preservado exclusivamente no encerramento do lote pelo SQL 025).
-- - NÃO executar de forma isolada nem aplicar em produção sem autorização expressa do responsável.
-- ==============================================================================

-- Preflight: Verificação de pré-requisitos estruturais (Incrementos 001–015)
do $preflight$
begin
  if to_regclass('app_private.churches') is null
    or to_regclass('app_private.church_access') is null
    or to_regclass('app_private.members') is null
    or to_regclass('app_private.events') is null
    or to_regclass('app_private.event_items') is null
    or to_regclass('app_private.audit_entries') is null then
    raise exception 'Estrutura base de igrejas, eventos e auditoria obrigatória (Incrementos 001–015).'
      using errcode = 'P0002';
  end if;

  if to_regclass('app_private.event_planning_receipts') is not null then
    raise exception 'Tabela app_private.event_planning_receipts já existente. Parar e conferir.'
      using errcode = '42P07';
  end if;
end;
$preflight$;

-- 1. Evolução da Tabela de Eventos com Políticas de Duração e Publicação
alter table app_private.events
  add column if not exists duration_policy text not null default 'warn' check (duration_policy in ('warn', 'block')),
  add column if not exists program_status text not null default 'draft' check (program_status in ('draft', 'published')),
  add column if not exists program_version integer not null default 1,
  add column if not exists published_at timestamptz,
  add column if not exists published_by_member_id uuid references app_private.members(id) on delete set null;

-- 2. Tabela de Recibos para Idempotência (Planejamento e Publicação de Eventos)
create table app_private.event_planning_receipts (
  user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  church_id uuid not null references app_private.churches(id) on delete restrict,
  action text not null,
  params jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, command_id)
);

-- 3. RLS e Privilégios da Tabela de Recibos
alter table app_private.event_planning_receipts enable row level security;
revoke all on app_private.event_planning_receipts from public, anon, authenticated, service_role;
alter table app_private.event_planning_receipts owner to postgres;

-- 4. Asserções Pós-Condição Estrutural
do $assertion$
begin
  if to_regclass('app_private.event_planning_receipts') is null then
    raise exception 'Falha de pós-condição estrutural: tabela app_private.event_planning_receipts não encontrada.'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'events' and column_name = 'duration_policy'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'events' and column_name = 'program_status'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'events' and column_name = 'program_version'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'events' and column_name = 'published_at'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'events' and column_name = 'published_by_member_id'
  ) then
    raise exception 'Falha de pós-condição estrutural: colunas de planejamento ausentes em app_private.events.'
      using errcode = 'P0002';
  end if;
end;
$assertion$;
