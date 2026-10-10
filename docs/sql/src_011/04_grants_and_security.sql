-- 11. Concessão e revogação de privilégios estritos sobre as novas RPCs
revoke all on function public.issue_church_invitation(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.issue_church_invitation(uuid, uuid, uuid, text) to authenticated;

revoke all on function public.get_invitation_details(text) from public, anon, service_role;
grant execute on function public.get_invitation_details(text) to authenticated;

revoke all on function public.redeem_invitation_confirm_name(uuid, text, text) from public, anon, service_role;
grant execute on function public.redeem_invitation_confirm_name(uuid, text, text) to authenticated;

revoke all on function public.redeem_invitation_propose_name(uuid, text, text) from public, anon, service_role;
grant execute on function public.redeem_invitation_propose_name(uuid, text, text) to authenticated;

revoke all on function public.get_my_access_request(uuid) from public, anon, service_role;
grant execute on function public.get_my_access_request(uuid) to authenticated;

revoke all on function public.list_church_invitations(uuid, text, integer, integer) from public, anon, service_role;
grant execute on function public.list_church_invitations(uuid, text, integer, integer) to authenticated;

revoke all on function public.list_church_access_requests(uuid, text, integer, integer) from public, anon, service_role;
grant execute on function public.list_church_access_requests(uuid, text, integer, integer) to authenticated;

revoke all on function public.decide_access_request(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.decide_access_request(uuid, uuid, uuid, text) to authenticated;

revoke all on function public.get_invitation_command_receipt(uuid) from public, anon, service_role;
grant execute on function public.get_invitation_command_receipt(uuid) to authenticated;

-- Preserva bloqueio estrito em command_receipts
alter table app_private.command_receipts enable row level security;
revoke all on table app_private.command_receipts from public, anon, authenticated, service_role;
