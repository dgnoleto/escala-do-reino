# Ensaio Transacional SQL 024 — Segurança da Instanciação de Modelos de Culto

**Data:** 20/10/2026
**Referência:** [Issue #27](https://github.com/dgnoleto/escala-do-reino/issues/27) · Homologação de Segurança / Gate 2
**Branch de trabalho:** `fix/homologacao-issues-51-25-27`
**Parecer da Revisão Técnica (Codex):** **ACEITO COM RESSALVAS**

---

## 1. Objetivo e Escopo do Ensaio

O objetivo do Gate 2 foi executar o ensaio transacional controlado do candidato de migração SQL 024 sobre o banco descartável `escala_rehearsal_024`, previamente preparado e isolado no Gate 1.

O incremento de segurança adiciona à função RPC `public.instantiate_service_template` a verificação mandatória de autorização de vínculo com a congregação (`app_private.has_church_settings_access(p_church_id, false)`), impedindo que usuários anônimos, usuários autenticados sem vínculo, membros de outras igrejas ou membros revogados obtenham o *preview* de instanciação estruturada de um modelo litúrgico.

O ensaio foi planejado e executado para garantir:
1. Reversibilidade incondicional através de `ROLLBACK` ao término da transação única.
2. Preservação integral do contrato canônico gerado pela migração `022_service_templates.sql` (propriedade camelCase `parallelServices`, filtro estrito de apoios ativos `is_default_active = true`, tipagem e campos de atividades e apoios).
3. Ausência de mutação persistente nos dados durante a chamada de instanciação (comportamento de leitura volátil/preview).
4. Integridade absoluta (delta zero) das tabelas monitoradas do banco principal `postgres`.

---

## 2. Identificação do Ambiente e Banco Utilizados

- **Container Docker:** `supabase_db_escala-convites-http-lab` (ID `2eba8f402a8e`).
- **Versão do SGBD:** PostgreSQL 17.11 on `x86_64-pc-linux-gnu`, compilado por GCC (GCC) 15.2.0, 64-bit.
- **Banco Alvo Exclusivo:** `escala_rehearsal_024` (verificado via `current_database()`).
- **Papel de Conexão:** `postgres` (verificado via `current_user`).
- **Porta Local:** `127.0.0.1:55332`.
- **Modo Transacional:** Sessão única no `psql` com `-v ON_ERROR_STOP=1`, `lock_timeout = '2s'`, `statement_timeout = '5s'`, transação explícita iniciada com `BEGIN;` e encerrada obrigatoriamente com `ROLLBACK;`.

---

## 3. Identificação dos Scripts SQL do Pacote 024

| Artefato | Finalidade | Hash SHA-256 |
| :--- | :--- | :--- |
| `docs/sql/024_service_template_instantiation_security.sql` | Candidato de migração (DDL / RPC com checagem de vínculo) | `2168E39F8BBAFA51E41AB3952037030DDCBEFB2B8F88A83D49620F41E100B1E5` |
| `docs/sql/024_preflight.sql` | Verificação estática pré-instalação de assinatura, owner e ACLs | `09CC061E099DFA5BF27A5EEAD2A5240C292192FDB4F3F288305155C6D14301C8` |
| `docs/sql/024_verify.sql` | Verificação pós-instalação de corpo, permissões e contrato | `F0DC83990395ADA079BCDE0A13F8F9578F3871E8C9A4EF97FBF4D3CAE444C940` |
| `docs/sql/024_rollback.sql` | Script de reversão cirúrgica documentada para o estado 022 | `51ABCAC48B13B6B52FB905E81D3F16D97F64EA4783EA7EC618514F25270F783F` |
| `docs/sql/024_rehearsal_cases.sql` | Casos de teste e fixtures de ensaio C01 a C10 | `77A6A0A725743CCD1161DEA8046BB20CA05D5365026E4DA16BE07B52318F7251` |
| `docs/sql/024_rehearsal_consolidated.sql` | Roteiro consolidado executável (Preflight + DDL + Verify + Casos + Rollback) | `8D6181CAE1E307076FECC7D04B7DB6FE0DE981FCC96C3D8F25FC72DDBED406CA` |

---

## 4. Comando Efetivamente Executado

O ensaio foi executado a partir do terminal do host via PowerShell em streaming binário/UTF-8 diretamente para o executável `psql` do container, garantindo conexão única e respeito estrito a `ON_ERROR_STOP=1`:

```powershell
powershell -NoProfile -Command "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content -Encoding UTF8 'docs\sql\024_rehearsal_consolidated.sql' -Raw | docker exec -i supabase_db_escala-convites-http-lab psql -U postgres -d escala_rehearsal_024 -v ON_ERROR_STOP=1"
```

Saída observada do comando (código de saída 0):
```text
BEGIN
SET
SET
NOTICE:  >> [1/4] Preflight aprovado com sucesso.
DO
CREATE FUNCTION
REVOKE
GRANT
ALTER FUNCTION
DO
NOTICE:  >> [2/4] Verificação contratual e de segurança aprovada.
CREATE FUNCTION
CREATE FUNCTION
INSERT 0 6
INSERT 0 2
INSERT 0 5
INSERT 0 5
INSERT 0 2
INSERT 0 2
INSERT 0 2
INSERT 0 2
NOTICE:  >> [3/4] Todos os 8 perfis de autorização e asserções contratuais C01 a C10 aprovados.
DO
DROP FUNCTION
DROP FUNCTION
ROLLBACK
                                  status
---------------------------------------------------------------------------
 ENSAIO 024 CONCLUÍDO COM 100% DE SUCESSO E REVERTIDO (ROLLBACK EFETUADO).
(1 row)
```

---

## 5. Aprovação do Preflight e do Verify

### 5.1 Preflight (Etapa 1 do Script Consolidado)
- Confirmou a existência da assinatura `public.instantiate_service_template(uuid, uuid, uuid)` com tipo de retorno `jsonb`.
- Confirmou owner `postgres`, `SECURITY DEFINER`, `search_path=""` e `statement_timeout=5s`.
- Confirmou a função auxiliar de autorização `app_private.has_church_settings_access(uuid, boolean)`.
- Confirmou o contrato base SQL 022 e privilégios prévios (concedido a `authenticated`; revogado de `anon`, `service_role` e `public`).
- **Resultado:** Aprovado (`NOTICE: >> [1/4] Preflight aprovado com sucesso.`).

### 5.2 Verify Pós-Aplicação Provisória (Etapa 3 do Script Consolidado)
- Validou que o corpo da função passou a conter a chamada `has_church_settings_access(p_church_id, false)`.
- Validou a preservação da chave `parallelServices`, a inexistência da chave snake_case `parallel_services`, o filtro de apoios ativos `is_default_active = true`, e os campos `plannedDurationMinutes`, `roster`, `musics`, `responsibleMemberId`, `responsibleTeamId`, `leaderId` e `volunteers`.
- Validou os privilégios e ownership pós-substituição.
- **Resultado:** Aprovado (`NOTICE: >> [2/4] Verificação contratual e de segurança aprovada.`).

---

## 6. Aprovação Agregada dos Cenários C01 a C10

Os cenários de negócio foram avaliados dentro de um bloco transacional PL/pgSQL com asserções estritas (`RAISE EXCEPTION` em caso de divergência). Conforme registrado no aviso unificado `NOTICE: >> [3/4] Todos os 8 perfis de autorização e asserções contratuais C01 a C10 aprovados.`, as seguintes regras foram homologadas:

| Identificador | Perfil Simulado | Alvo Avaliado | Comportamento Esperado | Código / SQLSTATE | Situação |
| :---: | :--- | :--- | :--- | :---: | :---: |
| **C01** | Role `anon` | Igreja 100 / Modelo 70 | Rejeição por não autenticado | `28000` | **Aprovado** |
| **C02** | `authenticated` sem vínculo | Igreja 100 / Modelo 70 | Rejeição por ausência de vínculo | `42501` | **Aprovado** |
| **C03** | Admin de outra igreja | Igreja 100 / Modelo 70 | Rejeição de acesso inter-igrejas | `42501` | **Aprovado** |
| **C04** | Membro com vínculo revogado | Igreja 100 / Modelo 70 | Rejeição de vínculo inativo | `42501` | **Aprovado** |
| **C05** | Membro comum ativo | Igreja 100 / Modelo 70 | Acesso autorizado (preview de liturgia) | `00000` | **Aprovado** |
| **C06** | Líder de liturgia (não admin) | Igreja 100 / Modelo 70 | Acesso autorizado (preview de liturgia) | `00000` | **Aprovado** |
| **C07** | Administrador da igreja | Igreja 100 / Modelo 70 | Acesso autorizado pleno | `00000` | **Aprovado** |
| **C08A** | Admin da Igreja 100 | Igreja 100 / Modelo 79 (Igreja 200) | Rejeição de modelo pertencente a outra congregação | `P0002` | **Aprovado** |
| **C08B** | Admin da Igreja 100 | Igreja 100 / Modelo 999 (inexistente) | Rejeição de modelo inexistente | `P0002` | **Aprovado** |
| **C09** | Validador do contrato JSON | Instanciação de Modelo Domingo 70 | Conformidade estrita tipológica e estrutural | `00000` | **Aprovado** |
| **C10** | Verificação de efeitos colaterais | Contagem e hash antes vs. depois | Ausência total de mutação persistente nas tabelas | `00000` | **Aprovado** |

---

## 7. Verificações do Contrato JSON (C09) e Contraprovas

O cenário C09 executou uma bateria dupla: validação estrutural do payload emitido e sete contraprovas negativas para atestar que o validador reprova anomalias sutis de contrato:

### 7.1 Validação Estrutural do Payload Canônico
- Raiz do objeto JSON contendo exclusivamente: `success` (true), `template_id` (uuid), `template_name` (string), `event_type_id` (uuid), `activities` (array), `parallelServices` (array). Chave `parallel_services` inexistente.
- Atividades com IDs no formato `act-<uuid>`, ordenadas por `display_order`, com `plannedDurationMinutes` numérico (10 e 30), `notes` preservadas, `requiresPlayback` booleano, `status` pendente, `responsibleMemberId` e `responsibleTeamId` nulos, e arrays `musics` e `roster` vazios.
- Apoios padrão com IDs no formato `serv-<uuid>`, nome `'Portaria'`, equipe `'recepcao'`, `prepRequiredMinutes` numérico (15), `status` `'Aguardando culto'`, `leaderId` nulo, `volunteers` vazio, e exclusão garantida do apoio inativo (`'Apoio Especial'`).

### 7.2 Resultados das Sete Contraprovas Internas de Validação
1. **Contraprova 1:** ID de serviço paralelo igual a JSON `null` -> Reprovado pelo validador.
2. **Contraprova 2:** ID de atividade ausente ou nulo -> Reprovado pelo validador.
3. **Contraprova 3:** Campo `responsibleMemberId` ausente da atividade -> Reprovado pelo validador.
4. **Contraprova 4:** Campo `responsibleTeamId` ausente da atividade -> Reprovado pelo validador.
5. **Contraprova 5:** `prepRequiredMinutes` como string (`"15"`) -> Reprovado pelo validador.
6. **Contraprova 6:** `plannedDurationMinutes` como string (`"10"`) -> Reprovado pelo validador.
7. **Contraprova 7:** `requiresPlayback` como string (`"false"`) -> Reprovado pelo validador.

---

## 8. Confirmação do ROLLBACK e Inspeção Posterior

A transação foi concluída com `ROLLBACK;`. Uma nova conexão independente foi imediatamente aberta com `escala_rehearsal_024` para comprovar a ausência de resíduos:

1. **Definição da RPC:** A função `public.instantiate_service_template` retornou exatamente à definição do SQL 022 original (sem a invocação de `has_church_settings_access`).
2. **Atributos do Catálogo:** OID (`200297`), Owner (`postgres`), proconfig (`{"search_path=\"\"",statement_timeout=5s}`) e permissões (somente `authenticated`) permaneceram inalterados.
3. **Ausência de Fixtures e Funções Temporárias:** Nenhuma linha residual permaneceu nas tabelas de `escala_rehearsal_024` (todas retornaram a 0 linhas), e as funções `pg_temp.st024_id` e `pg_temp.st024_as` não deixaram resíduos em nenhum schema do catálogo.

---

## 9. Comparação das Contagens e Fingerprints

### 9.1 Banco Descartável `escala_rehearsal_024`

| Tabela | Pré-Ensaio | Pós-Rollback | Delta | Fingerprint Pré-Ensaio | Fingerprint Pós-Rollback |
| :--- | :---: | :---: | :---: | :--- | :--- |
| `auth.users` | 0 | 0 | 0 | `a2e4822a98337283e39f7b60acf85ec9` | `a2e4822a98337283e39f7b60acf85ec9` |
| `app_private.churches` | 0 | 0 | 0 | `a2e4822a98337283e39f7b60acf85ec9` | `a2e4822a98337283e39f7b60acf85ec9` |
| `app_private.members` | 0 | 0 | 0 | `a2e4822a98337283e39f7b60acf85ec9` | `a2e4822a98337283e39f7b60acf85ec9` |
| `app_private.church_access` | 0 | 0 | 0 | `a2e4822a98337283e39f7b60acf85ec9` | `a2e4822a98337283e39f7b60acf85ec9` |
| `app_private.access_invitations` | 0 | 0 | 0 | `a2e4822a98337283e39f7b60acf85ec9` | `a2e4822a98337283e39f7b60acf85ec9` |
| `app_private.access_requests` | 0 | 0 | 0 | `a2e4822a98337283e39f7b60acf85ec9` | `a2e4822a98337283e39f7b60acf85ec9` |
| `app_private.audit_entries` | 0 | 0 | 0 | `a2e4822a98337283e39f7b60acf85ec9` | `a2e4822a98337283e39f7b60acf85ec9` |
| `app_private.event_types` | 0 | 0 | 0 | `a2e4822a98337283e39f7b60acf85ec9` | `a2e4822a98337283e39f7b60acf85ec9` |
| `app_private.service_templates` | 0 | 0 | 0 | `a2e4822a98337283e39f7b60acf85ec9` | `a2e4822a98337283e39f7b60acf85ec9` |
| `app_private.service_template_activities` | 0 | 0 | 0 | `a2e4822a98337283e39f7b60acf85ec9` | `a2e4822a98337283e39f7b60acf85ec9` |
| `app_private.service_template_parallel_services` | 0 | 0 | 0 | `a2e4822a98337283e39f7b60acf85ec9` | `a2e4822a98337283e39f7b60acf85ec9` |

### 9.2 Banco Principal `postgres` (7 Tabelas Monitoradas)

| Tabela Monitorada (`postgres`) | Pré-Ensaio | Pós-Ensaio | Delta | Fingerprint Pré-Ensaio | Fingerprint Pós-Ensaio |
| :--- | :---: | :---: | :---: | :--- | :--- |
| `auth.users` | 7 | 7 | 0 | `f34971e9c79e8be4d76cd5a64c0f537f` | `f34971e9c79e8be4d76cd5a64c0f537f` |
| `app_private.churches` | 4 | 4 | 0 | `899d4c259ad87fc1f375a6794b174eb1` | `899d4c259ad87fc1f375a6794b174eb1` |
| `app_private.members` | 32 | 32 | 0 | `3a3d239925ecad9fb120e518807d137f` | `3a3d239925ecad9fb120e518807d137f` |
| `app_private.church_access` | 11 | 11 | 0 | `6abeb9046e6bb2b2997b528ee7e83d28` | `6abeb9046e6bb2b2997b528ee7e83d28` |
| `app_private.access_invitations` | 11 | 11 | 0 | `edcdc346b616b61c45a0f022a1c16233` | `edcdc346b616b61c45a0f022a1c16233` |
| `app_private.access_requests` | 4 | 4 | 0 | `e74a1dd66fa02c7d2d1826672fcc2ac1` | `e74a1dd66fa02c7d2d1826672fcc2ac1` |
| `app_private.audit_entries` | 95 | 95 | 0 | `8bfd6609f4aa5531430a3f9130bf295e` | `8bfd6609f4aa5531430a3f9130bf295e` |

---

## 10. Parecer Técnico Final e Ressalvas do Codex

### Parecer do Codex: **ACEITO COM RESSALVAS**

A revisão técnica do transcript bruto confirmou a execução do ensaio no PostgreSQL 17.11 com saída zero e reversão transacional garantida por `ROLLBACK`. O encerramento do Gate 2 foi aprovado com a anotação obrigatória das seguintes quatro ressalvas técnicas:

1. **Ausência de logs individualizados dos cenários:**
   Os cenários C01 a C10 foram executados agrupados dentro do bloco anônimo PL/pgSQL `DO $cases$`. Embora falhas teriam interrompido a execução imediatamente via `RAISE EXCEPTION` com `ON_ERROR_STOP=1`, a saída padrão do `psql` gerou uma confirmação agregada única (`NOTICE: >> [3/4]`), sem emitir linhas de log discriminadas individualmente por cenário no transcript bruto.
2. **Alcance limitado das sete contraprovas JSON:**
   As contraprovas do C09 injetam anomalias tipológicas e estruturais específicas (IDs nulos, omissão de campos e tipos string em vez de inteiro/booleano). Elas comprovam que o validador interno do teste rejeita essas distorções pontuais, mas não esgotam combinatoriamente todo o espaço de permutações sintáticas do validador.
3. **Fingerprint parcial de `auth.users`:**
   O hash MD5 da tabela `auth.users` foi gerado utilizando a concatenação `id::text || ':' || updated_at::text`. Essa fórmula atesta a integridade temporal e a contagem das contas de usuário sem expor dados sensíveis, mas não cobre a serialização integral das colunas `raw_app_meta_data`, `raw_user_meta_data` ou `email`.
4. **Ausência de validação HTTP / PostgREST:**
   O ensaio comprovou estritamente o comportamento transacional e as regras de segurança no motor relacional PostgreSQL via driver/CLI nativo. Ele não substitui os testes de integração HTTP de borda (PostgREST, serialização de cabeçalhos JWT, status HTTP 401/403/404, CORS e transporte de rede), que permanecem como escopo da validação de borda do laboratório (Gate 3).

---

## 11. Preservação do Banco de Laboratório

Em conformidade com as diretrizes de governança, o banco descartável `escala_rehearsal_024` **permanece preservado e intacto** no cluster local para eventual inspeção do responsável, não tendo sido submetido a nenhum comando `DROP DATABASE`.
