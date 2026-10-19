-- Escala do Reino: reversão cirúrgica do incremento 022 (Service Templates - Issue #27)
-- Remove RPCs públicas, funções auxiliares, índices e tabelas associadas.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Remoção das RPCs públicas de modelos de culto
drop function if exists public.instantiate_service_template(uuid, uuid, uuid);
drop function if exists public.delete_service_template(uuid, uuid);
drop function if exists public.toggle_service_template_status(uuid, uuid, boolean);
drop function if exists public.update_service_template(uuid, uuid, uuid, text, text, jsonb, jsonb);
drop function if exists public.create_service_template(uuid, uuid, uuid, text, text, jsonb, jsonb);
drop function if exists public.get_service_template(uuid);
drop function if exists public.list_service_templates(uuid, boolean, uuid);

-- 2. Remoção da função auxiliar de auditoria/uso
drop function if exists app_private.is_service_template_used(uuid, uuid, text);

-- 3. Remoção das tabelas de itens, dados e recibos
drop table if exists app_private.service_template_receipts;
drop table if exists app_private.service_template_parallel_services;
drop table if exists app_private.service_template_activities;
drop table if exists app_private.service_templates;

-- 4. Notificação de recarga de schema para PostgREST
notify pgrst, 'reload schema';

commit;
