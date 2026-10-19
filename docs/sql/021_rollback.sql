-- Escala do Reino: reversão cirúrgica do incremento 021 (Event Types & Activities - Issue #25)
-- Remove RPCs públicas, funções auxiliares, índices e tabelas associadas.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Remoção das RPCs públicas de atividades padrão
drop function if exists public.delete_standard_activity(uuid, uuid, uuid);
drop function if exists public.toggle_standard_activity_status(uuid, uuid, uuid);
drop function if exists public.update_standard_activity(uuid, uuid, uuid, text, integer, text, text);
drop function if exists public.create_standard_activity(uuid, uuid, text, integer, text, text);
drop function if exists public.list_standard_activities(uuid, boolean);

-- 2. Remoção das RPCs públicas de tipos de evento
drop function if exists public.delete_event_type(uuid, uuid, uuid);
drop function if exists public.toggle_event_type_status(uuid, uuid, uuid);
drop function if exists public.update_event_type(uuid, uuid, uuid, text, text);
drop function if exists public.create_event_type(uuid, uuid, text, text);
drop function if exists public.list_event_types(uuid, boolean);

-- 3. Remoção das funções auxiliares de auditoria/uso
drop function if exists app_private.is_standard_activity_used(uuid, uuid, text);
drop function if exists app_private.is_event_type_used(uuid, uuid, text);

-- 4. Remoção das tabelas de dados e recibos
drop table if exists app_private.event_type_activity_receipts;
drop table if exists app_private.standard_activities;
drop table if exists app_private.event_types;

-- 5. Notificação de recarga de schema para PostgREST
notify pgrst, 'reload schema';

commit;
