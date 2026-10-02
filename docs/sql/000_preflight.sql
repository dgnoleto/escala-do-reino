-- Consulta somente leitura: executar antes de criar a estrutura.
select
  current_setting('server_encoding') as server_encoding,
  current_setting('client_encoding') as client_encoding,
  to_regnamespace('app_private') is null as app_private_available,
  to_regclass('auth.users') is not null as supabase_auth_present;
