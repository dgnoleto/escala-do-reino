-- ==============================================================================
-- 024_rollback.sql
-- Reversão para a Definição de Referência Original (SQL 022)
-- Issue #27 / Parecer do Codex / Homologação
--
-- ATENÇÃO CRÍTICA DE SEGURANÇA:
-- A restauração desta função reabre a vulnerabilidade de autorização que permite a
-- usuários autenticados instanciar modelos de cultos pertencentes a outras igrejas
-- sem checagem de vínculo com a igreja (cross-church leakage).
-- O rollback SOMENTE deve ser executado em ambiente de laboratório para testes ou
-- sob decisão expressa e controlada da equipe técnica.
-- Em ensaios de laboratório, executar de forma transacional (BEGIN ... ROLLBACK)
-- para não deixar o ambiente em estado vulnerável.
-- ==============================================================================

begin;

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

commit;
