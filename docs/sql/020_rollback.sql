-- Escala do Reino: reversão cirúrgica do incremento 020 (Cancellation Reasons - Issue #26)
-- Remove RPCs públicas, funções auxiliares, índices e tabelas associadas.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Remoção das RPCs públicas de motivos de cancelamento
drop function if exists public.delete_cancellation_reason(uuid, uuid, uuid);
drop function if exists public.toggle_cancellation_reason_status(uuid, uuid, uuid, boolean);
drop function if exists public.update_cancellation_reason(uuid, uuid, uuid, text);
drop function if exists public.create_cancellation_reason(uuid, uuid, text);
drop function if exists public.list_cancellation_reasons(uuid, boolean);

-- 2. Remoção da função auxiliar de auditoria/uso
drop function if exists app_private.is_cancellation_reason_used(uuid, uuid, text);

-- 3. Remoção das tabelas de dados e recibos
drop table if exists app_private.cancellation_reason_receipts;
drop table if exists app_private.cancellation_reasons;

-- 4. Notificação de recarga de schema para PostgREST
notify pgrst, 'reload schema';

commit;
