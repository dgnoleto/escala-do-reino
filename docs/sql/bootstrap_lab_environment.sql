-- ============================================================================
-- Escala do Reino — Bootstrap de Infraestrutura Efêmera de Laboratório
-- ============================================================================
-- Banco Alvo Dedicado: escala_rehearsal_tmp (PostgreSQL 15+)
--
-- AVISO NORMATIVO E ESCOPO:
-- Este script provisiona os esquemas, tabelas, extensões, funções e papéis
-- necessários para viabilizar a execução dos scripts de migração e testes 000–012
-- em uma base efêmera dedicada de laboratório.
--
-- DECLARAÇÃO EXPLÍCITA:
-- Este bootstrap simula os objetos de banco de dados do esquema `auth` e suas
-- dependências relacionais (com auth.users.email como varchar(255) conforme o Auth nativo do Supabase),
-- MAS NÃO VALIDA O SERVIÇO HTTP/REDE SUPABASE AUTH (GoTrue) e não permite login GoTrue.
-- NUNCA execute este script contra instâncias de produção, homologação ou o projeto piloto remoto.
-- ============================================================================

-- 1. Extensões criptográficas necessárias para CSPRNG (gen_random_bytes)
create extension if not exists pgcrypto;

-- 2. Papéis padrão do ecossistema Supabase
do $setup_roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$setup_roles$;

-- 3. Esquema e tabela auth.users com TODOS os campos exigidos por 000–010 e pelo preflight 011
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email varchar(255) unique,
  email_confirmed_at timestamptz,
  deleted_at timestamptz,
  banned_until timestamptz,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

-- 4. Função auth.uid() para resolução de JWT claims na sessão
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- 5. Privilégios mínimos sobre auth
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
