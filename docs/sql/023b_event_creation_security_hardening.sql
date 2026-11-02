-- ==============================================================================
-- 023b_event_creation_security_hardening.sql
-- Candidato RPC: Criação Segura de Edições de Eventos (create_church_event_edition)
--
-- Rastreabilidade: Issues #28 e #58
-- Decisão do Responsável: https://github.com/dgnoleto/escala-do-reino/issues/58#issuecomment-6386407831
-- Auditoria Independente: Parecer Técnico Codex D1–D7 e Ownership Aprovados Estaticamente
--
-- ESCOPO EXCLUSIVO DESTE ARTEFATO:
-- Implementação blindada da RPC public.create_church_event_edition em conformidade
-- com os critérios de paridade contratual D1–D7 e todas as erratas aprovadas:
--   - Assinatura canônica estrita (8 parâmetros e 6 campos de retorno originais).
--   - Regra de negócio Opção B ratificada (admin ou líder ministerial cria; apenas admin designa dirigente litúrgico).
--   - Ordem demonstrável e compatível de locks:
--       1º pg_advisory_xact_lock (user_id, command_id)
--       2º app_private.event_planning_receipts (leitura sob advisory lock)
--       3º app_private.churches FOR SHARE
--       4º app_private.church_access FOR SHARE
--       5º app_private.members FOR SHARE (aquisição progressiva ordenada por UUID ASC)
--       6º auth.users FOR SHARE
--       7º app_private.teams FOR SHARE (proteção de equipe qualificadora para não-admin)
--       8º Mutações atômicas: events -> event_planning_receipts -> audit_entries
--   - Precedência estrita de autorização: não-admin tentando designar dirigente é barrado com 42501
--     antes de qualquer leitura ou bloqueio do membro alvo.
--   - Restauração do SQLSTATE contratual 23503 para dirigente inexistente/inativo em criação autorizada.
--   - Validação da conta Auth executada estritamente antes da inspeção do dirigente alvo.
--   - Canonicalização temporal D6 em UTC com precisão de microssegundos e era (BC/AD).
--   - Tratamento conservador de reconciliação de recibos históricos incompatíveis (rejeição com 23505 sem auto command_id).
--   - Replay seguro (Abordagem 1): validação de elegibilidade e autoridade atual do chamador,
--     sem exigir que o dirigente histórico permaneça ativo.
--   - SECURITY DEFINER, search_path = '', statement_timeout = '5s'.
--   - Transferência explícita de ownership para postgres e asserção compulsória em catálogo (pg_proc).
--
-- DIRETRIZES DE GOVERNANÇA E CONTROLE TRANSACIONAL:
-- - Este arquivo NÃO embute BEGIN ou COMMIT internos, assegurando total controle
--   ao wrapper / executor para ensaios reversíveis sob ROLLBACK ou composição
--   atômica com os componentes 023a e 025.
-- - NÃO contém comando NOTIFY na execução da RPC (preservado exclusivamente no SQL 025).
-- - NÃO executar de forma isolada nem aplicar em produção sem autorização expressa do responsável.
-- ==============================================================================

create or replace function public.create_church_event_edition(
  p_church_id uuid,
  p_command_id uuid,
  p_title text,
  p_event_type text,
  p_planned_start_at timestamptz,
  p_planned_end_at timestamptz,
  p_liturgy_leader_member_id uuid default null,
  p_duration_policy text default 'warn'
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
  v_user_id                  uuid;
  v_caller_member_id         uuid;
  v_is_admin                 boolean;
  v_timezone                 text;
  v_title_clean              text;
  v_type_clean               text;
  v_policy_clean             text;
  v_existing_receipt         app_private.event_planning_receipts%rowtype;
  v_event_id                 uuid;
  v_payload                  jsonb;
  v_created_at               timestamptz;
  v_params_canonical         jsonb;
  v_is_replay                boolean := false;
  v_expected_member_ids      uuid[];
  v_member_record            app_private.members%rowtype;
  v_caller_member            app_private.members%rowtype;
  v_leader_member            app_private.members%rowtype;
  v_orig_leader              uuid;
  v_qualifying_team_id       uuid;
  c_action constant          text := 'create_church_event_edition';
begin
  -- 1. Delimitação estrita de isolamento transacional
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  -- 2. Autenticação obrigatória
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 3. Parâmetros obrigatórios e integridade sintática (Paridade SQL 023)
  if p_church_id is null or p_command_id is null or p_title is null
     or p_planned_start_at is null or p_planned_end_at is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_title_clean := btrim(normalize(p_title, NFC));
  if char_length(v_title_clean) < 1 or char_length(v_title_clean) > 200 then
    raise exception 'Título do evento deve ter entre 1 e 200 caracteres.' using errcode = '22000';
  end if;

  -- Default 'Culto' se NULL; rejeição estrita de string vazia
  v_type_clean := btrim(normalize(coalesce(p_event_type, 'Culto'), NFC));
  if char_length(v_type_clean) < 1 then
    raise exception 'Tipo do evento não pode ser vazio.' using errcode = '22000';
  end if;

  v_policy_clean := lower(btrim(coalesce(p_duration_policy, 'warn')));
  if v_policy_clean not in ('warn', 'block') then
    raise exception 'Política de duração inválida. Opções: warn ou block.' using errcode = '22000';
  end if;

  -- CA01 de #28: término deve ser estritamente posterior ao início
  if p_planned_end_at <= p_planned_start_at then
    raise exception 'Data/hora de término planejada deve ser posterior ao início.' using errcode = '22000';
  end if;

  -- 4. Canonicalização de parâmetros (Achados D1 e D6: UTC, microssegundos e era BC/AD)
  v_params_canonical := jsonb_build_object(
    'title', v_title_clean,
    'event_type', v_type_clean,
    'planned_start_at', btrim(to_char(p_planned_start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z" BC')),
    'planned_end_at', btrim(to_char(p_planned_end_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z" BC')),
    'liturgy_leader_member_id', p_liturgy_leader_member_id,
    'duration_policy', v_policy_clean
  );

  -- 5. [Lock 1º] Advisory lock imediato de comando (Idempotência por comando/usuário)
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- 6. [Lock 2º] Validação do recibo compartilhado (Achados D1 e D3)
  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_canonical then
      raise exception 'Comando já utilizado com outros parâmetros ou ação divergente.' using errcode = '23505';
    end if;
    v_is_replay := true;
  end if;

  -- 7. [Lock 3º] Estado da Igreja e Fuso Horário (conforme SQL 025:31)
  select coalesce(c.timezone, 'America/Sao_Paulo') into v_timezone
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 8. [Lock 4º] Vínculo de Acesso do Chamador (conforme SQL 025:32 e SQL 016:147)
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null then
    raise exception 'Usuário sem vínculo de acesso ativo nesta igreja.' using errcode = '42501';
  end if;

  -- Precedência de Autorização (CA03 de #28 / Achado D5):
  -- Não-admin tentando designar dirigente litúrgico é barrado imediatamente (42501),
  -- antes de qualquer leitura ou bloqueio do membro alvo.
  if not v_is_replay and p_liturgy_leader_member_id is not null and not v_is_admin then
    raise exception 'Somente administradores podem designar a liderança da liturgia.' using errcode = '42501';
  end if;

  -- 9. [Lock 5º] Aquisição Progressiva em app_private.members (UUID ASC) (Achado D5)
  -- Montagem deduplicada do conjunto de membros necessários antes do primeiro lock:
  if v_is_replay then
    v_expected_member_ids := array[v_caller_member_id];
  else
    v_expected_member_ids := array[v_caller_member_id];
    if p_liturgy_leader_member_id is not null and p_liturgy_leader_member_id <> v_caller_member_id then
      v_expected_member_ids := array_append(v_expected_member_ids, p_liturgy_leader_member_id);
    end if;
  end if;

  -- Aquisição progressiva de locks linha a linha em ordem determinística UUID ASC.
  -- As variáveis v_caller_member e v_leader_member são inicializadas como NULL
  -- e preenchidas EXCLUSIVAMENTE a partir das tuplas alcançadas pelo cursor sob FOR SHARE.
  v_caller_member := null;
  v_leader_member := null;

  for v_member_record in
    select m.*
    from app_private.members m
    where m.church_id = p_church_id
      and m.id = any(v_expected_member_ids)
    order by m.id asc
    for share
  loop
    if v_member_record.id = v_caller_member_id then
      v_caller_member := v_member_record;
    end if;
    if not v_is_replay and p_liturgy_leader_member_id is not null and v_member_record.id = p_liturgy_leader_member_id then
      v_leader_member := v_member_record;
    end if;
  end loop;

  -- Elegibilidade do Chamador pós-bloqueio -> 42501
  if v_caller_member.id is null or v_caller_member.status <> 'active' then
    raise exception 'Membro chamador inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 10. [Lock 6º] Conta Auth do Chamador (conforme SQL 025:34)
  -- Executado estritamente ANTES da validação de negócio do dirigente alvo.
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

  -- 11. Validação de Alvo e Regras de Negócio Pós-Auth (Achados D4 e D5)
  if v_is_replay then
    -- Ramo de Replay (Abordagem 1 / Opção B):
    -- O dirigente histórico NÃO é reavaliado nem exigido ativo (fato documental passado).
    v_orig_leader := (v_existing_receipt.params->>'liturgy_leader_member_id')::uuid;

    if v_orig_leader is not null then
      -- Comando original com líder de liturgia: exige admin ativo
      if not v_is_admin then
        raise exception 'Replay não autorizado: o comando original exigia perfil de administrador.' using errcode = '42501';
      end if;
    else
      -- Comando original sem líder de liturgia: admite admin ativo ou líder ministerial ativo
      if not v_is_admin then
        -- [Lock 7º] Equipe Qualificadora no Replay
        perform 1
        from app_private.teams t
        where t.church_id = p_church_id
          and t.leader_member_id = v_caller_member_id
          and t.status = 'active'
        for share;

        if not found then
          raise exception 'Replay não autorizado: operador sem autoridade administrativa ou liderança ministerial vigente.' using errcode = '42501';
        end if;
      end if;
    end if;

    -- Devolução do resultado histórico com zero mutações adicionais
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Ramo de Nova Criação:
  if p_liturgy_leader_member_id is not null then
    -- Dirigente Inexistente, Inativo ou de Outra Igreja -> 23503 (Tratado pelo cliente)
    -- Avaliado somente após o chamador comprovar plena elegibilidade e autorização.
    if v_leader_member.id is null or v_leader_member.status <> 'active' then
      raise exception 'Membro designado como líder da liturgia não existe ou está inativo.' using errcode = '23503';
    end if;
  else
    -- Criação sem líder de liturgia (Opção B Ratificada):
    if not v_is_admin then
      -- [Lock 7º] Proteção de Equipe Qualificadora (conforme SQL 015:555)
      select t.id into v_qualifying_team_id
      from app_private.teams t
      where t.church_id = p_church_id
        and t.leader_member_id = v_caller_member_id
        and t.status = 'active'
      limit 1
      for share;

      if not found then
        raise exception 'Criação de evento restrita a administradores ou líderes ministeriais ativos desta igreja.' using errcode = '42501';
      end if;
    end if;
  end if;

  -- 12. Escrita Transacional Atômica (CA04 de #28)
  v_event_id := gen_random_uuid();
  v_created_at := clock_timestamp();

  insert into app_private.events (
    id,
    church_id,
    title,
    event_type,
    timezone,
    status,
    planned_start_at,
    planned_end_at,
    liturgy_leader_member_id,
    duration_policy,
    program_status,
    program_version,
    created_at,
    updated_at
  ) values (
    v_event_id,
    p_church_id,
    v_title_clean,
    v_type_clean,
    v_timezone,
    'scheduled',
    p_planned_start_at,
    p_planned_end_at,
    p_liturgy_leader_member_id,
    v_policy_clean,
    'draft',
    1,
    v_created_at,
    v_created_at
  );

  v_payload := jsonb_build_object(
    'event_id', v_event_id,
    'title', v_title_clean,
    'timezone', v_timezone,
    'planned_start_at', p_planned_start_at,
    'planned_end_at', p_planned_end_at,
    'duration_policy', v_policy_clean,
    'program_status', 'draft',
    'status', 'scheduled'
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_canonical, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', v_event_id, v_payload
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    v_event_id,
    v_payload,
    v_created_at;
end;
$function$;

-- Permissões de Execução e Titularidade
revoke all on function public.create_church_event_edition(uuid, uuid, text, text, timestamptz, timestamptz, uuid, text) from public, anon, service_role;
grant execute on function public.create_church_event_edition(uuid, uuid, text, text, timestamptz, timestamptz, uuid, text) to authenticated;

alter function public.create_church_event_edition(
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  uuid,
  text
) owner to postgres;

-- Asserção Pós-Instalação de Ownership em Catálogo (pg_proc)
do $$
declare
  v_proc oid;
  v_owner text;
begin
  v_proc := to_regprocedure('public.create_church_event_edition(uuid, uuid, text, text, timestamptz, timestamptz, uuid, text)');
  if v_proc is null then
    raise exception 'Falha de pós-condição de instalação: função public.create_church_event_edition não encontrada no catálogo.'
      using errcode = 'P0002';
  end if;

  select r.rolname into v_owner
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where p.oid = v_proc;

  if v_owner is distinct from 'postgres' then
    raise exception 'Falha de pós-condição de instalação: proprietário efetivo de public.create_church_event_edition é "%" (esperado: "postgres"). Transação abortada.',
      coalesce(v_owner, '<nulo>')
      using errcode = '42501';
  end if;
end;
$$;
