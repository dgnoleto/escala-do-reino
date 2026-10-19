-- Escala do Reino: reversão cirúrgica do incremento 023 (Event Planning & Durations - Issues #28, #29, #30)
-- Remove RPCs públicas, tabela de recibos e colunas adicionadas a events.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Remoção das RPCs públicas de planejamento e conferência de duração
drop function if exists public.save_event_program_draft(uuid, uuid, uuid);
drop function if exists public.publish_event_program(uuid, uuid, uuid);
drop function if exists public.set_event_duration_policy(uuid, uuid, uuid, text);
drop function if exists public.reorder_event_items(uuid, uuid, uuid, uuid[]);
drop function if exists public.create_church_event_edition(uuid, uuid, text, text, timestamptz, timestamptz, uuid, text);

-- 2. Remoção da tabela de recibos
drop table if exists app_private.event_planning_receipts;

-- 3. Remoção das colunas estendidas em app_private.events
alter table app_private.events
  drop column if exists published_by_member_id,
  drop column if exists published_at,
  drop column if exists program_version,
  drop column if exists program_status,
  drop column if exists duration_policy;

-- 4. Notificação de recarga de schema para PostgREST
notify pgrst, 'reload schema';

commit;
