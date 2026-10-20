-- ==============================================================================
-- 024_rollback.sql
-- Reversão para a Definição de Referência Original (SQL 022)
-- Issue #27 / Parecer do Codex / Homologação
--
-- CONTROLE TRANSACIONAL E POLÍTICA DE SEGURANÇA:
-- Este script NÃO possui comandos BEGIN ou COMMIT internos.
--
-- AVISO CRÍTICO DE SEGURANÇA (VULNERABILIDADE CROSS-CHURCH):
-- A restauração desta definição do SQL 022 reabre a vulnerabilidade de autorização
-- que permite a usuários autenticados instanciar modelos de culto de outras igrejas
-- sem verificação de vínculo associativo (cross-church leakage).
-- Portanto, a aplicação definitiva deste rollback é ESTRITAMENTE EXCEPCIONAL e
-- PROIBIDA sem formalização prévia de risco e aprovação expressa da governança.
--
-- PROCEDIMENTO DE CONTENÇÃO MAIS SEGURO PARA EMERGÊNCIAS (RECOMENDADO / SUJEITO A AUTORIZAÇÃO):
-- Em caso de incidente operacional na RPC após a aplicação da 024, a alternativa
-- de contenção recomendada — em vez de reinstalar a função vulnerável do SQL 022 — é:
--   REVOKE EXECUTE ON FUNCTION public.instantiate_service_template(uuid, uuid, uuid) FROM authenticated, anon, public;
-- Isso suspende temporariamente a execução da RPC sem reabrir vazamento entre
-- igrejas (cross-church leakage), enquanto a correção é homologada.
--
-- ------------------------------------------------------------------------------
-- 1. PROCEDIMENTO DE ENSAIO REVERSÍVEL DE LABORATÓRIO (NÃO PERSISTE NO BANCO)
-- ------------------------------------------------------------------------------
-- Qualquer ensaio DEVE OBRIGATORIAMENTE operar na mesma conexão e sob transação
-- explícita encerrada com ROLLBACK, impedindo a restauração permanente da vulnerabilidade.
--
-- A. VIA SUPABASE STUDIO SQL EDITOR (WEB / SEM METARECURSOS \i):
--    Copiar e colar o bloco encapsulado em transação não-persistente:
--      BEGIN;
--      -- <colar o conteúdo deste script 024_rollback.sql>
--      -- <asserções opcionais de teste>
--      ROLLBACK;
--
-- B. VIA POWERSHELL + DOCKER (LOCAL NO WINDOWS):
--    Garantir que BEGIN, o script e o ROLLBACK sejam enviados na MESMA chamada e conexão psql:
--      $rehearsal = "BEGIN;`n" + (Get-Content docs\sql\024_rollback.sql -Raw) + "`nROLLBACK;"
--      $rehearsal | docker exec -i supabase_db_escala-convites-http-lab psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- ------------------------------------------------------------------------------
-- 2. PROCEDIMENTO DE REVERSÃO DEFINITIVA EXCEPCIONAL (APENAS COM AUTORIZAÇÃO FORMAL DE RISCO)
-- ------------------------------------------------------------------------------
-- Se e somente se houver aprovação expressa da governança técnica:
--    BEGIN;
--    -- <colar o conteúdo deste script 024_rollback.sql>
--    COMMIT;
--
-- AVISO DE COMPATIBILIDADE DE EXECUTOR (PowerShell vs Docker vs Supabase Studio):
-- Comandos com barra invertida (\i, \set, \c) são metacomandos específicos do binário
-- psql e falham se colados no editor web do Supabase Studio.
-- ==============================================================================

set local lock_timeout = '2s';
set local statement_timeout = '5s';

-- Restauração exata da RPC instantiate_service_template conforme SQL 022 (linhas 770-838)
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
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_st from app_private.service_templates where id = p_template_id and church_id = p_church_id;
  if not found then
    raise exception 'Modelo de culto não encontrado na igreja especificada.' using errcode = 'P0002';
  end if;

  -- Atividades como cópia independente e sem alocação nominal de pessoas (CA03)
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

  -- Serviços paralelos como cópia independente e sem voluntários escalados (CA03)
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

-- Privilégios e Ownership conforme SQL 022
revoke all on function public.instantiate_service_template(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.instantiate_service_template(uuid, uuid, uuid) to authenticated;
alter function public.instantiate_service_template(uuid, uuid, uuid) owner to postgres;

notify pgrst, 'reload schema';
