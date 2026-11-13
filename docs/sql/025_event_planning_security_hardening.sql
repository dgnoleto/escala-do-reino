-- ==============================================================================
-- 025_event_planning_security_hardening.sql
-- Incremento Estrito de Hardening de Segurança e Idempotência (Gate 3 - Pré-homologação)
--
-- Referência: docs/sql/023_event_planning_and_durations.sql (Issues #28, #29, #30)
-- Auditoria Independente: Parecer Técnico do Codex (Aprovado com Correções A1–A4, B1/B2)
-- Rastreabilidade: Issue #57
--
-- ESCOPO EXCLUSIVO DESTE ARTEFATO:
-- Reimplementação segura, estrita e transacionalmente coordenada das 4 RPCs:
--   1. public.reorder_event_items(uuid, uuid, uuid, uuid[])
--   2. public.set_event_duration_policy(uuid, uuid, uuid, text)
--   3. public.publish_event_program(uuid, uuid, uuid)
--   4. public.save_event_program_draft(uuid, uuid, uuid)
--
-- DIRETRIZES DE GOVERNANÇA E CONTROLE TRANSACIONAL:
-- - Este arquivo NÃO embute BEGIN ou COMMIT internos, assegurando total controle
--   ao executor para ensaios reversíveis sob ROLLBACK ou futura aplicação autorizada.
-- - NÃO aplicar diretamente em produção ou no piloto sem autorização prévia expressa.
--
-- CORREÇÕES DE HARDENING INCORPORADAS NESTA REVISÃO (B1/B2 - FOCAL):
-- 1. ISOLAMENTO TRANSACIONAL SUPORTADO (Achado A4):
--    - Exigência explícita e mandatória de READ COMMITTED no preâmbulo de cada RPC.
--    - Garante que cada instrução após uma espera por lock opere sob um snapshot
--      fresco e atualizado, sem alterar parâmetros globais do cluster PostgreSQL.
--
-- 2. ORDEM DEMONSTRÁVEL DE AQUISIÇÃO DE LOCKS EM INSTRUÇÕES SEPARADAS (Achado B1):
--    - Para eliminar a dependência do plano de execução do JOIN sobre a sequência física
--      de travas, a aquisição de recursos é executada em instruções SQL separadas:
--        1º: pg_advisory_xact_lock(user_id, command_id)  [Idempotência de comando]
--        2º: app_private.churches FOR SHARE              [Estado da igreja protegido]
--        3º: app_private.church_access FOR SHARE         [Vínculo de acesso do chamador]
--        4º: app_private.members FOR SHARE               [Membro do chamador correspondente]
--        5º: auth.users FOR SHARE                        [Conta Auth protegida contra ban/exclusão]
--        6º: app_private.events FOR UPDATE               [Serialização de mutações no evento]
--    - Alinhamento rigoroso com os escritores canônicos anteriores:
--        * SQL 016 deactivate_church_member (linhas 147–150): bloqueia church_access antes de members.
--        * SQL 016 public.restore_church_member (linhas 432–442): bloqueia explicitamente church_access antes de members.
--        * SQL 016 create_event_item (linhas 2555–2567) e SQL 015 assign_event_participant (linha 2894):
--          bloqueiam members antes de events.
--        * SQL 018 manage_church_admin: avalia o chamador com acesso e membro sob lock compartilhado;
--          no alvo, diferencia membro e acesso. O SQL 025 alinha o chamador à ordem mestra de ciclo de vida.
--    - ATENÇÃO: Esta hierarquia estabelece uma mitigação demonstrável para os ciclos
--      identificados entre os escritores mapeados; NÃO declara ausência global de
--      deadlocks fora desse escopo delimitado ou em operações multi-evento concorrentes.
--
-- 3. DOCUMENTAÇÃO DOS ESCRITORES EFETIVOS (Achado B2):
--    - Referenciação canônica e correta das implementações aplicáveis no laboratório e piloto:
--      desativação e restauração em SQL 016 estabelecem a ordem canônica acesso -> membro;
--      escritores litúrgicos em SQL 016 e 015 estabelecem membro -> evento.
--
-- 4. REVALIDAÇÃO COMPLETA DE AUTORIDADE E CONDIÇÕES DE AUTH (Achado A2):
--    - Após a aquisição do lock exclusivo do evento (espera potencial), reavaliação
--      mandatória sob READ COMMITTED de church_access, members, churches e auth.users.
--    - Verifica exaustivamente: status ativo da igreja e do membro, conclusão de onboarding,
--      e-mail confirmado, ausência de exclusão (deleted_at is null), rejeição de anônimos
--      e ausência de banimento ativo (banned_until).
--
-- 5. REPLAY SEGURO SOB ABORDAGEM 1 - SEGURANÇA ESTRITA (Achado A3):
--    - Em caso de comando repetido (replay), o recibo histórico somente é retornado
--      APÓS a confirmação integral de autoridade atual sobre o evento (admin ou líder
--      atual da liturgia), impedindo vazamento de dados para operadores com autoridade revogada.
--
-- 6. VALIDAÇÃO ROBUSTA DE ARRAYS E PRESERVAÇÃO DE PAYLOADS:
--    - Validação de NULL via array_position(p_ordered_item_ids, null) (código 22023).
--    - Suporte a subconjuntos válidos pertencentes ao evento.
--    - Preservação do payload original do SQL 023 para array vazio (array_length).
--
-- 7. AUTORIZAÇÃO E ARMADILHA DE NULL:
--    - Se liturgy_leader_member_id for NULL no evento, membros comuns jamais recebem
--      permissão; autorização reservada estritamente a administradores elegíveis.
-- ==============================================================================

set local lock_timeout = '2s';
set local statement_timeout = '5s';

-- ------------------------------------------------------------------------------
-- 1. RPC: public.reorder_event_items
-- ------------------------------------------------------------------------------
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
  c_action constant text := 'reorder_event_items';
begin
  -- 1. Delimitação de isolamento transacional suportado (Achado A4)
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  -- 2. Autenticação obrigatória
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 3. Parâmetros obrigatórios e integridade estrutural
  if p_church_id is null or p_command_id is null or p_event_id is null or p_ordered_item_ids is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- Validação estrita de NULL em elementos do array (imune a armadilhas de comparação do SQL)
  if array_position(p_ordered_item_ids, null) is not null then
    raise exception 'Lista de itens ordenada não pode conter valores nulos.' using errcode = '22023';
  end if;

  -- 4. Checagem preliminar não-autoritativa (fail-fast contra chamadores ilegítimos)
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

  -- 5. Parâmetros canônicos para idempotência
  v_params_hash := jsonb_build_object(
    'event_id', p_event_id,
    'ordered_item_ids', to_jsonb(p_ordered_item_ids)
  );

  -- 6. Ordem demonstrável de locks — 1º: Comando de Idempotência
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- 7. Validação de divergência de recibo existente
  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
    -- Abordagem 1 (Segurança Estrita, Achado A3): Replay NÃO retorna aqui.
    -- Segue adiante para confirmar autoridade atual sobre o evento antes de devolver o resultado.
  end if;

  -- 8. Ordem demonstrável de locks — 2º: Estado da Igreja (protege status ativo contra alteração concorrente)
  perform 1
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 9. Ordem demonstrável de locks — 3º: Vínculo de Acesso do Chamador (Achados B1/B2)
  -- Bloqueia a linha de church_access do chamador antes de members, em estrita compatibilidade
  -- com o protocolo canônico do SQL 016 (deactivate_church_member e public.restore_church_member).
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  if v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Inconsistência cadastral no vínculo de acesso do chamador.' using errcode = '42501';
  end if;

  -- 10. Ordem demonstrável de locks — 4º: Membro do Chamador (Achados B1/B2)
  -- Bloqueia o membro correspondente obtido do acesso bloqueado antes de events, em estrita
  -- compatibilidade com SQL 016 create_event_item e SQL 015 assign_event_participant.
  perform 1
  from app_private.members m
  where m.church_id = p_church_id
    and m.id = v_caller_member_id
    and m.status = 'active'
  for share;

  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 11. Ordem demonstrável de locks — 5º: Conta Auth do Chamador
  -- Bloqueia a conta auth para validação de banimento, exclusão e confirmação de e-mail.
  perform 1
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 12. Ordem demonstrável de locks — 6º: Evento Alvo (serialização de mutações no evento)
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- 13. Revalidação definitiva de autoridade e elegibilidade após esperas por locks (Achado A2, B1)
  -- Reavalia church_access, members, churches e auth.users protegendo contra mutações concorrentes durante a espera
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

  -- Autorização estrita sobre o evento: admin elegível OU líder da liturgia deste evento (NULL nunca concede permissão)
  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_caller_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para reordenar este evento.' using errcode = '42501';
  end if;

  -- 14. Retorno de Replay sob Abordagem 1 - Segurança Estrita (Achado A3)
  -- Somente retorna o recibo histórico APÓS confirmar a autoridade atual sobre o evento
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

  -- 15. Validação de integridade e pertencimento dos itens informados (aceita subconjuntos válidos e array vazio)
  v_items_count := coalesce(cardinality(p_ordered_item_ids), 0);

  if v_items_count > 0 then
    select count(distinct ei.id) into v_matching_items_count
    from app_private.event_items ei
    where ei.church_id = p_church_id
      and ei.event_id = p_event_id
      and ei.id = any(p_ordered_item_ids);

    if v_matching_items_count <> v_items_count then
      raise exception 'Um ou mais itens não pertencem a este evento ou foram informados em duplicidade.' using errcode = '22023';
    end if;

    -- Execução atômica da reordenação dos itens informados
    v_created_at := clock_timestamp();

    foreach v_item_id in array p_ordered_item_ids
    loop
      update app_private.event_items ei
      set sequence_order = v_order,
          updated_at = v_created_at
      where ei.church_id = p_church_id
        and ei.event_id = p_event_id
        and ei.id = v_item_id;
      v_order := v_order + 1;
    end loop;
  else
    v_created_at := clock_timestamp();
  end if;

  update app_private.events e
  set updated_at = v_created_at
  where e.church_id = p_church_id and e.id = p_event_id;

  -- Preserva preferencialmente o payload original do SQL 023 (array_length)
  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'total_items_reordered', array_length(p_ordered_item_ids, 1)
  );

  -- 16. Persistência de recibo e auditoria
  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload
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
-- 2. RPC: public.set_event_duration_policy
-- ------------------------------------------------------------------------------
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
  -- 1. Delimitação de isolamento transacional suportado (Achado A4)
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  -- 2. Autenticação obrigatória
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 3. Parâmetros obrigatórios e sanitização da política
  if p_church_id is null or p_command_id is null or p_event_id is null or p_duration_policy is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_policy_clean := lower(btrim(p_duration_policy));
  if v_policy_clean not in ('warn', 'block') then
    raise exception 'Política de duração inválida. Opções: warn ou block.' using errcode = '22000';
  end if;

  -- 4. Checagem preliminar não-autoritativa (fail-fast contra chamadores ilegítimos)
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

  -- 5. Parâmetros canônicos para idempotência
  v_params_hash := jsonb_build_object(
    'event_id', p_event_id,
    'duration_policy', v_policy_clean
  );

  -- 6. Ordem demonstrável de locks — 1º: Comando de Idempotência
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- 7. Validação de divergência de recibo existente
  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
    -- Abordagem 1 (Segurança Estrita, Achado A3): Replay aguarda confirmação de autoridade atual sobre o evento.
  end if;

  -- 8. Ordem demonstrável de locks — 2º: Estado da Igreja (protege status ativo contra alteração concorrente)
  perform 1
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 9. Ordem demonstrável de locks — 3º: Vínculo de Acesso do Chamador (Achados B1/B2)
  -- Bloqueia a linha de church_access do chamador antes de members, em estrita compatibilidade
  -- com o protocolo canônico do SQL 016 (deactivate_church_member e public.restore_church_member).
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  if v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Inconsistência cadastral no vínculo de acesso do chamador.' using errcode = '42501';
  end if;

  -- 10. Ordem demonstrável de locks — 4º: Membro do Chamador (Achados B1/B2)
  -- Bloqueia o membro correspondente obtido do acesso bloqueado antes de events, em estrita
  -- compatibilidade com SQL 016 create_event_item e SQL 015 assign_event_participant.
  perform 1
  from app_private.members m
  where m.church_id = p_church_id
    and m.id = v_caller_member_id
    and m.status = 'active'
  for share;

  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 11. Ordem demonstrável de locks — 5º: Conta Auth do Chamador
  -- Bloqueia a conta auth para validação de banimento, exclusão e confirmação de e-mail.
  perform 1
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 12. Ordem demonstrável de locks — 6º: Evento Alvo (serialização de mutações no evento)
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- 13. Revalidação definitiva de autoridade e elegibilidade após esperas por locks (Achado A2, B1)
  -- Reavalia church_access, members, churches e auth.users protegendo contra mutações concorrentes durante a espera
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
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share of ca, m, u;

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  -- Autorização estrita sobre o evento: admin elegível OU líder da liturgia deste evento (NULL nunca concede permissão)
  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_caller_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para alterar a política de duração.' using errcode = '42501';
  end if;

  -- 14. Retorno de Replay sob Abordagem 1 - Segurança Estrita (Achado A3)
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

  -- 15. Execução da mutação
  v_created_at := clock_timestamp();

  update app_private.events e
  set duration_policy = v_policy_clean,
      updated_at = v_created_at
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'duration_policy', v_policy_clean
  );

  -- 16. Persistência de recibo e auditoria
  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload
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
-- 3. RPC: public.publish_event_program
-- ------------------------------------------------------------------------------
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
  -- 1. Delimitação de isolamento transacional suportado (Achado A4)
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  -- 2. Autenticação obrigatória
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 3. Parâmetros obrigatórios
  if p_church_id is null or p_command_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- 4. Checagem preliminar não-autoritativa (fail-fast contra chamadores ilegítimos)
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

  -- 5. Parâmetros canônicos para idempotência
  v_params_hash := jsonb_build_object('event_id', p_event_id);

  -- 6. Ordem demonstrável de locks — 1º: Comando de Idempotência
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- 7. Validação de divergência de recibo existente
  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
    -- Abordagem 1 (Segurança Estrita, Achado A3): Replay aguarda confirmação de autoridade atual sobre o evento.
  end if;

  -- 8. Ordem demonstrável de locks — 2º: Estado da Igreja (protege status ativo contra alteração concorrente)
  perform 1
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 9. Ordem demonstrável de locks — 3º: Vínculo de Acesso do Chamador (Achados B1/B2)
  -- Bloqueia a linha de church_access do chamador antes de members, em estrita compatibilidade
  -- com o protocolo canônico do SQL 016 (deactivate_church_member e public.restore_church_member).
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  if v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Inconsistência cadastral no vínculo de acesso do chamador.' using errcode = '42501';
  end if;

  -- 10. Ordem demonstrável de locks — 4º: Membro do Chamador (Achados B1/B2)
  -- Bloqueia o membro correspondente obtido do acesso bloqueado antes de events, em estrita
  -- compatibilidade com SQL 016 create_event_item e SQL 015 assign_event_participant.
  perform 1
  from app_private.members m
  where m.church_id = p_church_id
    and m.id = v_caller_member_id
    and m.status = 'active'
  for share;

  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 11. Ordem demonstrável de locks — 5º: Conta Auth do Chamador
  -- Bloqueia a conta auth para validação de banimento, exclusão e confirmação de e-mail.
  perform 1
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 12. Ordem demonstrável de locks — 6º: Evento Alvo (serialização de mutações no evento)
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- 13. Revalidação definitiva de autoridade e elegibilidade após esperas por locks (Achado A2, B1)
  -- Reavalia church_access, members, churches e auth.users protegendo contra mutações concorrentes durante a espera
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

  -- Autorização estrita sobre o evento: admin elegível OU líder da liturgia deste evento (NULL nunca concede permissão)
  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_caller_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para publicar a programação deste evento.' using errcode = '42501';
  end if;

  -- 14. Retorno de Replay sob Abordagem 1 - Segurança Estrita (Achado A3)
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

  -- 15. Apuração de duração e verificação da política de bloqueio
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

  -- 16. Execução da publicação com incremento seguro de versão sob row-lock
  v_created_at := clock_timestamp();

  update app_private.events e
  set program_status = 'published',
      published_at = v_created_at,
      published_by_member_id = v_caller_member_id,
      program_version = program_version + 1,
      updated_at = v_created_at
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'program_status', 'published',
    'duration_policy', v_event.duration_policy,
    'available_seconds', v_available_seconds,
    'occupied_seconds', v_total_occupied_seconds,
    'overflow_seconds', v_overflow_seconds,
    'published_at', v_created_at
  );

  -- 17. Persistência de recibo e auditoria
  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload
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
-- 4. RPC: public.save_event_program_draft
-- ------------------------------------------------------------------------------
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
  -- 1. Delimitação de isolamento transacional suportado (Achado A4)
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  -- 2. Autenticação obrigatória
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 3. Parâmetros obrigatórios
  if p_church_id is null or p_command_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- 4. Checagem preliminar não-autoritativa (fail-fast contra chamadores ilegítimos)
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

  -- 5. Parâmetros canônicos para idempotência
  v_params_hash := jsonb_build_object('event_id', p_event_id);

  -- 6. Ordem demonstrável de locks — 1º: Comando de Idempotência
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- 7. Validação de divergência de recibo existente
  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
    -- Abordagem 1 (Segurança Estrita, Achado A3): Replay aguarda confirmação de autoridade atual sobre o evento.
  end if;

  -- 8. Ordem demonstrável de locks — 2º: Estado da Igreja (protege status ativo contra alteração concorrente)
  perform 1
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 9. Ordem demonstrável de locks — 3º: Vínculo de Acesso do Chamador (Achados B1/B2)
  -- Bloqueia a linha de church_access do chamador antes de members, em estrita compatibilidade
  -- com o protocolo canônico do SQL 016 (deactivate_church_member e public.restore_church_member).
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  if v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Inconsistência cadastral no vínculo de acesso do chamador.' using errcode = '42501';
  end if;

  -- 10. Ordem demonstrável de locks — 4º: Membro do Chamador (Achados B1/B2)
  -- Bloqueia o membro correspondente obtido do acesso bloqueado antes de events, em estrita
  -- compatibilidade com SQL 016 create_event_item e SQL 015 assign_event_participant.
  perform 1
  from app_private.members m
  where m.church_id = p_church_id
    and m.id = v_caller_member_id
    and m.status = 'active'
  for share;

  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 11. Ordem demonstrável de locks — 5º: Conta Auth do Chamador
  -- Bloqueia a conta auth para validação de banimento, exclusão e confirmação de e-mail.
  perform 1
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 12. Ordem demonstrável de locks — 6º: Evento Alvo (serialização de mutações no evento)
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- 13. Revalidação definitiva de autoridade e elegibilidade após esperas por locks (Achado A2, B1)
  -- Reavalia church_access, members, churches e auth.users protegendo contra mutações concorrentes durante a espera
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

  -- Autorização estrita sobre o evento: admin elegível OU líder da liturgia deste evento (NULL nunca concede permissão)
  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_caller_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para salvar rascunho deste evento.' using errcode = '42501';
  end if;

  -- 14. Retorno de Replay sob Abordagem 1 - Segurança Estrita (Achado A3)
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

  -- 15. Execução da reversão/manutenção para rascunho
  v_created_at := clock_timestamp();

  update app_private.events e
  set program_status = 'draft',
      updated_at = v_created_at
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'program_status', 'draft'
  );

  -- 16. Persistência de recibo e auditoria
  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload
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
-- 5. Privilégios e Ownership
-- ------------------------------------------------------------------------------
revoke all on function public.reorder_event_items(uuid, uuid, uuid, uuid[]) from public, anon, service_role;
grant execute on function public.reorder_event_items(uuid, uuid, uuid, uuid[]) to authenticated;

revoke all on function public.set_event_duration_policy(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.set_event_duration_policy(uuid, uuid, uuid, text) to authenticated;

revoke all on function public.publish_event_program(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.publish_event_program(uuid, uuid, uuid) to authenticated;

revoke all on function public.save_event_program_draft(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.save_event_program_draft(uuid, uuid, uuid) to authenticated;

alter function public.reorder_event_items(uuid, uuid, uuid, uuid[]) owner to postgres;
alter function public.set_event_duration_policy(uuid, uuid, uuid, text) owner to postgres;
alter function public.publish_event_program(uuid, uuid, uuid) owner to postgres;
alter function public.save_event_program_draft(uuid, uuid, uuid) owner to postgres;

notify pgrst, 'reload schema';
