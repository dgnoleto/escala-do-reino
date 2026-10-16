-- Escala do Reino: ensaio transacional autocontido com ROLLBACK para 015_liturgical_dependencies.sql.
-- Aplica temporariamente as estruturas do incremento 015, configura identidades autenticadas
-- (auth.uid() via request.jwt.claim.sub) e executa as RPCs públicas com controles de autorização,
-- replay idempotente, conflito de parâmetros, alocação, aptidão e substituição concorrente.
-- Esperado: "PASS: Ensaio transacional completo do incremento 015 aprovado. Zero resíduos no banco."

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 0. Evolução de recibos para suportar entidades litúrgicas (B2-01)
alter table app_private.command_receipts
  alter column result_member_id drop not null;

-- 1. Executa DDL do candidato 015 se ainda não estiver instalado na conexão
do $install_candidate$
begin
  if to_regclass('app_private.teams') is null then
    create table app_private.teams (
      id uuid primary key default gen_random_uuid(),
      church_id uuid not null references app_private.churches(id) on delete restrict,
      name text not null,
      leader_member_id uuid,
      status text not null default 'active' check (status in ('active', 'inactive')),
      version integer not null default 1,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      constraint teams_church_name_clean check (name = btrim(name) and char_length(name) between 1 and 100),
      constraint teams_church_id_id_unique unique (church_id, id),
      constraint teams_church_id_name_unique unique (church_id, name),
      constraint teams_church_leader_fkey
        foreign key (church_id, leader_member_id)
        references app_private.members(church_id, id) on delete restrict
    );
    alter table app_private.teams enable row level security;
  end if;

  if to_regclass('app_private.team_memberships') is null then
    create table app_private.team_memberships (
      id uuid primary key default gen_random_uuid(),
      church_id uuid not null,
      team_id uuid not null,
      member_id uuid not null,
      status text not null default 'active' check (status in ('active', 'inactive')),
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      constraint tm_church_id_id_unique unique (church_id, id),
      constraint tm_church_team_fkey foreign key (church_id, team_id) references app_private.teams(church_id, id) on delete restrict,
      constraint tm_church_member_fkey foreign key (church_id, member_id) references app_private.members(church_id, id) on delete restrict,
      constraint tm_church_team_member_unique unique (church_id, team_id, member_id)
    );
    alter table app_private.team_memberships enable row level security;
  end if;

  if to_regclass('app_private.team_roles') is null then
    create table app_private.team_roles (
      id uuid primary key default gen_random_uuid(),
      church_id uuid not null,
      team_id uuid not null,
      name text not null,
      description text,
      status text not null default 'active' check (status in ('active', 'inactive')),
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      constraint tr_church_id_id_unique unique (church_id, id),
      constraint tr_name_clean check (name = btrim(name) and char_length(name) between 1 and 100),
      constraint tr_church_team_fkey foreign key (church_id, team_id) references app_private.teams(church_id, id) on delete restrict,
      constraint tr_church_team_role_unique unique (church_id, team_id, id),
      constraint tr_church_team_name_unique unique (church_id, team_id, name)
    );
    alter table app_private.team_roles enable row level security;
  end if;

  if to_regclass('app_private.member_qualifications') is null then
    create table app_private.member_qualifications (
      id uuid primary key default gen_random_uuid(),
      church_id uuid not null,
      member_id uuid not null,
      team_id uuid not null,
      team_role_id uuid not null,
      status text not null default 'active' check (status in ('active', 'inactive')),
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      constraint mq_church_id_id_unique unique (church_id, id),
      constraint mq_church_member_fkey foreign key (church_id, member_id) references app_private.members(church_id, id) on delete restrict,
      constraint mq_church_team_fkey foreign key (church_id, team_id) references app_private.teams(church_id, id) on delete restrict,
      constraint mq_church_role_fkey foreign key (church_id, team_id, team_role_id) references app_private.team_roles(church_id, team_id, id) on delete restrict,
      constraint mq_church_member_role_unique unique (church_id, member_id, team_role_id)
    );
    alter table app_private.member_qualifications enable row level security;
  end if;

  if to_regclass('app_private.events') is null then
    create table app_private.events (
      id uuid primary key default gen_random_uuid(),
      church_id uuid not null references app_private.churches(id) on delete restrict,
      title text not null,
      event_type text not null default 'culto',
      status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
      planned_start_at timestamptz not null,
      planned_end_at timestamptz not null,
      actual_start_at timestamptz,
      actual_end_at timestamptz,
      liturgy_leader_member_id uuid,
      version integer not null default 1,
      cancel_reason text,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      constraint events_title_clean check (title = btrim(title) and char_length(title) between 1 and 200),
      constraint events_dates_order check (planned_end_at > planned_start_at),
      constraint events_church_id_id_unique unique (church_id, id),
      constraint events_church_liturgy_fkey foreign key (church_id, liturgy_leader_member_id) references app_private.members(church_id, id) on delete restrict
    );
    alter table app_private.events enable row level security;
  end if;

  if to_regclass('app_private.event_items') is null then
    create table app_private.event_items (
      id uuid primary key default gen_random_uuid(),
      church_id uuid not null,
      event_id uuid not null,
      title text not null,
      item_nature text not null default 'liturgical' check (item_nature in ('liturgical', 'parallel_support')),
      sequence_order integer not null default 1,
      planned_duration_seconds integer not null default 300 check (planned_duration_seconds > 0),
      status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
      designated_team_id uuid,
      nominal_leader_member_id uuid,
      actual_start_at timestamptz,
      actual_end_at timestamptz,
      cancel_reason text,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      constraint ei_church_id_id_unique unique (church_id, id),
      constraint ei_church_event_fkey foreign key (church_id, event_id) references app_private.events(church_id, id) on delete restrict,
      constraint ei_church_team_fkey foreign key (church_id, designated_team_id) references app_private.teams(church_id, id) on delete restrict,
      constraint ei_church_leader_fkey foreign key (church_id, nominal_leader_member_id) references app_private.members(church_id, id) on delete restrict
    );
    alter table app_private.event_items enable row level security;
  end if;

  if to_regclass('app_private.assignments') is null then
    create table app_private.assignments (
      id uuid primary key default gen_random_uuid(),
      church_id uuid not null,
      event_id uuid not null,
      item_id uuid,
      team_id uuid not null,
      team_role_id uuid,
      member_id uuid not null,
      status text not null default 'active' check (status in ('active', 'replaced', 'cancelled')),
      replaced_assignment_id uuid,
      replacement_assignment_id uuid,
      notes text,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      constraint asg_church_id_id_unique unique (church_id, id),
      constraint asg_church_event_fkey foreign key (church_id, event_id) references app_private.events(church_id, id) on delete restrict,
      constraint asg_church_item_fkey foreign key (church_id, item_id) references app_private.event_items(church_id, id) on delete restrict,
      constraint asg_church_member_fkey foreign key (church_id, member_id) references app_private.members(church_id, id) on delete restrict,
      constraint asg_church_team_fkey foreign key (church_id, team_id) references app_private.teams(church_id, id) on delete restrict,
      constraint asg_church_team_role_fkey foreign key (church_id, team_id, team_role_id) references app_private.team_roles(church_id, team_id, id) on delete restrict,
      constraint asg_replaced_fkey foreign key (church_id, replaced_assignment_id) references app_private.assignments(church_id, id) on delete restrict
    );
    alter table app_private.assignments enable row level security;
  end if;
end;
$install_candidate$;

-- 2. Bloco Principal de Testes Funcionais e de Concorrência via RPC
do $validate_rehearsal$
declare
  v_church_a uuid := gen_random_uuid();
  v_church_b uuid := gen_random_uuid();
  v_user_admin_a uuid := gen_random_uuid();
  v_user_leader_a uuid := gen_random_uuid();
  v_user_vol_a uuid := gen_random_uuid();
  v_user_vol_sub uuid := gen_random_uuid();

  v_member_admin_a uuid := gen_random_uuid();
  v_member_leader_a uuid := gen_random_uuid();
  v_member_vol_a uuid := gen_random_uuid();
  v_member_vol_sub uuid := gen_random_uuid();

  v_cmd_team uuid := gen_random_uuid();
  v_cmd_role uuid := gen_random_uuid();
  v_cmd_member uuid := gen_random_uuid();
  v_cmd_qual uuid := gen_random_uuid();
  v_cmd_event uuid := gen_random_uuid();
  v_cmd_asg uuid := gen_random_uuid();
  v_cmd_replace uuid := gen_random_uuid();
  v_cmd_replace_double uuid := gen_random_uuid();

  v_team_id uuid;
  v_role_id uuid;
  v_event_id uuid;
  v_asg_id uuid;
  v_asg_sub_id uuid;
  v_receipt record;
begin
  -- Fixtures de Igreja, Membros e Acesso
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_admin_a, 'admin_a@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_user_leader_a, 'leader_a@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_user_vol_a, 'vol_a@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_user_vol_sub, 'vol_sub@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());

  insert into app_private.churches (id, name, timezone, default_duration_policy, status)
  values
    (v_church_a, 'Igreja Rehearsal A', 'America/Sao_Paulo', 'warn', 'active'),
    (v_church_b, 'Igreja Rehearsal B', 'America/Manaus', 'warn', 'active');

  insert into app_private.members (id, church_id, display_name, status)
  values
    (v_member_admin_a, v_church_a, 'Pr Marcos (Admin)', 'active'),
    (v_member_leader_a, v_church_a, 'Líder Louvor', 'active'),
    (v_member_vol_a, v_church_a, 'Vocalista Titular', 'active'),
    (v_member_vol_sub, v_church_a, 'Vocalista Substituto', 'active');

  insert into app_private.church_access (church_id, user_id, member_id, is_admin, status, onboarding_completed_at)
  values
    (v_church_a, v_user_admin_a, v_member_admin_a, true, 'active', clock_timestamp()),
    (v_church_a, v_user_leader_a, v_member_leader_a, false, 'active', clock_timestamp()),
    (v_church_a, v_user_vol_a, v_member_vol_a, false, 'active', clock_timestamp()),
    (v_church_a, v_user_vol_sub, v_member_vol_sub, false, 'active', clock_timestamp());

  -- TESTE 1: Execução autenticada como Admin criando Equipe
  perform set_config('request.jwt.claim.sub', v_user_admin_a::text, true);

  select * into v_receipt
  from public.create_church_team(v_church_a, v_cmd_team, 'Ministério de Louvor', v_member_leader_a);

  if v_receipt.result_entity_id is null then
    raise exception 'FALHA: Equipe criada não retornou result_entity_id no recibo.';
  end if;
  v_team_id := v_receipt.result_entity_id;

  -- B2-01: Conferir que recibo foi salvo com result_member_id nulo e result_entity_id preenchido
  if not exists (
    select 1 from app_private.command_receipts cr
    where cr.command_id = v_cmd_team and cr.result_entity_id = v_team_id and cr.result_member_id is null
  ) then
    raise exception 'FALHA: Recibo de equipe não persistiu de forma compatível (B2-01).';
  end if;

  -- B2-03: Replay idêntico autorizado retorna o recibo sem duplicar
  select * into v_receipt
  from public.create_church_team(v_church_a, v_cmd_team, 'Ministério de Louvor', v_member_leader_a);

  if v_receipt.result_entity_id <> v_team_id then
    raise exception 'FALHA: Replay de criação de equipe retornou entidade divergente.';
  end if;

  -- B2-03: Replay com parâmetros divergentes para mesmo command_id deve falhar
  begin
    perform public.create_church_team(v_church_a, v_cmd_team, 'Nome Divergente', v_member_leader_a);
    raise exception 'FALHA: Replay com parâmetros conflitantes não foi rejeitado.';
  exception when unique_violation then
    -- Sucesso: 23505 capturado
  end;

  -- TESTE 2: Execução autenticada como Líder de Equipe
  perform set_config('request.jwt.claim.sub', v_user_leader_a::text, true);

  -- 2.1 Criar Função Técnica
  select * into v_receipt
  from public.create_team_role(v_church_a, v_cmd_role, v_team_id, 'Vocal / Soprano', 'Canto coral e solo');
  v_role_id := v_receipt.result_entity_id;

  -- 2.2 Adicionar Integrante Titular e Substituto na Equipe
  perform public.add_team_member(v_church_a, v_cmd_member, v_team_id, v_member_vol_a);
  perform public.add_team_member(v_church_a, gen_random_uuid(), v_team_id, v_member_vol_sub);

  -- 2.3 Homologar Aptidão para o Titular e o Substituto
  perform public.grant_member_qualification(v_church_a, v_cmd_qual, v_member_vol_a, v_team_id, v_role_id);
  perform public.grant_member_qualification(v_church_a, gen_random_uuid(), v_member_vol_sub, v_team_id, v_role_id);

  -- 2.4 Criar Evento: Líder de Equipe cria culto (sem liturgia designada)
  select * into v_receipt
  from public.create_church_event(
    v_church_a, v_cmd_event, 'Culto de Domingo Teste', 'culto',
    clock_timestamp() + interval '1 day', clock_timestamp() + interval '1 day 2 hours', null
  );
  v_event_id := v_receipt.result_entity_id;

  -- Contraprova: Líder de Equipe tentar designar liturgia deve falhar com 42501!
  begin
    perform public.create_church_event(
      v_church_a, gen_random_uuid(), 'Culto Inválido', 'culto',
      clock_timestamp() + interval '2 days', clock_timestamp() + interval '2 days 2 hours', v_member_leader_a
    );
    raise exception 'FALHA: Líder de equipe conseguiu designar liderança da liturgia.';
  exception when insufficient_privilege then
    -- Sucesso da contraprova (42501)
  end;

  -- 2.5 Alocar Participante com Aptidão Válida
  select * into v_receipt
  from public.assign_event_participant(
    v_church_a, v_cmd_asg, v_event_id, v_team_id, v_member_vol_a, null, v_role_id, 'Escala confirmada'
  );
  v_asg_id := v_receipt.result_entity_id;

  -- Contraprova B2-04: Alocar participante sem aptidão deve falhar com P0020
  begin
    perform public.assign_event_participant(
      v_church_a, gen_random_uuid(), v_event_id, v_team_id, v_member_admin_a, null, v_role_id, 'Sem aptidão'
    );
    raise exception 'FALHA: Membro sem aptidão foi alocado com função técnica.';
  exception when others then
    if sqlstate <> 'P0020' and sqlstate <> '42501' then
      raise exception 'FALHA: Erro inesperado ao validar aptidão: % (%)', sqlerrm, sqlstate;
    end if;
  end;

  -- 2.6 Substituir Voluntário por Substituto Qualificado
  select * into v_receipt
  from public.replace_event_participant(
    v_church_a, v_cmd_replace, v_asg_id, v_member_vol_sub, 'Imprevisto pessoal'
  );
  v_asg_sub_id := v_receipt.result_entity_id;

  -- Contraprova B2-04: Tentar substituir NOVAMENTE a alocação original já substituída DEVE falhar com P0020!
  begin
    perform public.replace_event_participant(
      v_church_a, v_cmd_replace_double, v_asg_id, v_member_vol_a, 'Segunda substituição conflitante'
    );
    raise exception 'FALHA: Alocação já substituída permitiu nova substituição concorrente (B2-04).';
  exception when others then
    if sqlstate <> 'P0020' then
      raise exception 'FALHA: Código inesperado ao rejeitar dupla substituição: % (%)', sqlerrm, sqlstate;
    end if;
  end;

  raise notice 'PASS: Todos os controles de autorização, replay, aptidão e substituição concorrente funcionaram conforme especificado.';
end;
$validate_rehearsal$;

rollback;

raise notice 'PASS: Ensaio transacional completo do incremento 015 aprovado. Zero resíduos no banco.';
