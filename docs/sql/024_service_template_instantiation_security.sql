-- ==============================================================================
-- 024_service_template_instantiation_security.sql
-- Incremento Estrito de Segurança: Autorização na RPC public.instantiate_service_template
-- Issue #27 / Parecer do Codex / Homologação
--
-- GUIA DE EXECUÇÃO E CONTROLE TRANSACIONAL:
-- Este script NÃO embute comandos COMMIT ou BEGIN internos, permitindo que o
-- executor controle integralmente a transação para ensaios reversíveis ou
-- eventual aplicação definitiva em produção.
--
-- AVISO DE COMPATIBILIDADE DE EXECUTOR (PowerShell / Windows / Supabase Studio):
-- Comandos com barra invertida (\i, \set) são específicos do executável psql e NÃO
-- funcionam se colados no SQL Editor web do Supabase Studio.
--
-- 1. PROCEDIMENTO DE ENSAIO REVERSÍVEL DE LABORATÓRIO:
--    A. VIA SUPABASE SQL EDITOR (WEB / SEM \i):
--       Copiar e colar o arquivo consolidado autônomo:
--       -> docs/sql/024_rehearsal_consolidated.sql
--       Ele executa Preflight, DDL, Verify e Rehearsal em transação estrita terminando em ROLLBACK;
--    B. VIA POWERSHELL + DOCKER (LOCAL NO WINDOWS):
--       Get-Content docs\sql\024_rehearsal_consolidated.sql -Raw | docker exec -i supabase_db_escala-convites-http-lab psql -U postgres -d postgres -v ON_ERROR_STOP=1
--    C. VIA CLI PSQL NATIVO:
--       psql -v ON_ERROR_STOP=1 -f docs/sql/024_rehearsal_consolidated.sql
--
-- 2. PROCEDIMENTO DE APLICAÇÃO PERMANENTE (SUJEITO A APROVAÇÃO EXPRESSA):
--    BEGIN;
--    -- Executar 024_preflight.sql
--    -- Executar 024_service_template_instantiation_security.sql
--    -- Executar 024_verify.sql
--    COMMIT;
--    (Somente se 100% dos passos anteriores tiverem sucesso comprovado)
--
-- OBJETIVO:
-- Corrigir a lacuna de autorização na RPC `public.instantiate_service_template`
-- adicionando a validação de vínculo legítimo com a igreja via:
--   app_private.has_church_settings_access(p_church_id, false)
--
-- PRESERVAÇÃO INTEGRAL DO CONTRATO SQL 022:
-- - Assinatura: (p_command_id uuid, p_church_id uuid, p_template_id uuid) -> jsonb
-- - Propriedades retornadas: 'parallelServices' (camelCase), 'activities', etc.
-- - Filtro de apoios: 'where stps.template_id = p_template_id and stps.is_default_active = true;'
-- - Atividades: campos id, title, category, plannedDurationMinutes, status ('pendente'),
--   responsibleMemberId (null), responsibleTeamId (null), notes, requiresPlayback, musics ([]), roster ([]).
-- - Apoios / Serviços Paralelos: campos id, name, teamId, leaderId (null), volunteers ([]),
--   status ('Aguardando culto'), prepRequiredMinutes.
-- - Owner: postgres. Privilégios: apenas authenticated; revogado de public, anon, service_role.
--
-- ATENÇÃO: NÃO EXECUTAR EM PRODUÇÃO SEM AUTORIZAÇÃO EXPRESSA.
-- ==============================================================================

set local lock_timeout = '2s';
set local statement_timeout = '5s';

create or replace function public.instantiate_service_template(
  p_command_id uuid,
  p_church_id uuid,
  p_template_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_st app_private.service_templates%rowtype;
  v_activities jsonb;
  v_parallel_services jsonb;
begin
  -- 1. Autenticação obrigatória
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 2. Verificação estrita de autorização de vínculo com a igreja (PRD §3.2 & #27)
  -- Consulta app_private.church_access e app_private.members para confirmar vínculo ativo
  -- Permite administradores e líderes da liturgia/membros autorizados (false = não exige admin)
  if not app_private.has_church_settings_access(p_church_id, false) then
    raise exception 'Acesso negado à igreja especificada.' using errcode = '42501';
  end if;

  -- 3. Existência do modelo no escopo da igreja informada
  select * into v_st from app_private.service_templates
  where id = p_template_id and church_id = p_church_id;

  if not found then
    raise exception 'Modelo de culto não encontrado na igreja especificada.' using errcode = 'P0002';
  end if;

  if v_st.active is not true then
    raise exception 'Modelo de culto desativado não pode ser aplicado a novos planejamentos.' using errcode = '23514';
  end if;

  -- 4. Atividades como cópia independente e sem alocação nominal de pessoas (CA03)
  -- Contrato fiel ao SQL 022
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', 'act-' || gen_random_uuid(),
      'title', sta.title,
      'category', sta.category,
      'plannedDurationMinutes', sta.planned_duration_minutes,
      'status', 'pendente',
      'responsibleMemberId', null,
      'responsibleTeamId', null,
      'notes', sta.notes,
      'requiresPlayback', sta.requires_playback,
      'musics', '[]'::jsonb,
      'roster', '[]'::jsonb
    ) order by sta.display_order asc
  ), '[]'::jsonb)
  into v_activities
  from app_private.service_template_activities sta
  where sta.template_id = p_template_id;

  -- 5. Serviços paralelos como cópia independente e sem voluntários escalados (CA03)
  -- Contrato fiel ao SQL 022: apenas ativos por padrão (is_default_active = true) e chave 'parallelServices'
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', 'serv-' || gen_random_uuid(),
      'name', stps.service_name,
      'teamId', stps.team_id,
      'leaderId', null,
      'volunteers', '[]'::jsonb,
      'status', 'Aguardando culto',
      'prepRequiredMinutes', stps.prep_required_minutes
    ) order by stps.display_order asc
  ), '[]'::jsonb)
  into v_parallel_services
  from app_private.service_template_parallel_services stps
  where stps.template_id = p_template_id and stps.is_default_active = true;

  return jsonb_build_object(
    'success', true,
    'template_id', v_st.id,
    'template_name', v_st.name,
    'event_type_id', v_st.event_type_id,
    'activities', v_activities,
    'parallelServices', v_parallel_services
  );
end;
$function$;

-- Privilégios e Ownership fiéis ao SQL 022
revoke all on function public.instantiate_service_template(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.instantiate_service_template(uuid, uuid, uuid) to authenticated;
alter function public.instantiate_service_template(uuid, uuid, uuid) owner to postgres;

notify pgrst, 'reload schema';
