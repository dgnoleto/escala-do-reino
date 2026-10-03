# Criação de Igreja ("Criar minha igreja") e Salvaguardas de Administração

Incremento de produto implementando o fluxo “Criar minha igreja” para contas elegíveis, criação atômica no servidor, restrição no banco de no máximo uma administração ativa por conta Auth, proteção com serialização contra remoção/desativação do último administrador elegível de uma igreja, ciclo de comandos idempotente no cliente, preservação de contexto de igreja selecionada e entrada segura na igreja recém-criada.

---

## 1. Contratos e Endpoints Públicos

As tabelas de `app_private` permanecem fechadas, fora dos esquemas expostos pela Data API, com RLS habilitada e sem privilégios diretos para `anon`, `authenticated` ou `service_role`. A interação para criação de igreja e salvaguardas ocorre exclusivamente por três funções RPC em `public`, qualificadas, com `security definer`, `search_path = ''`, `set statement_timeout = '5s'` e permissão de execução concedida somente ao papel `authenticated`.

A identidade do usuário é derivada exclusivamente de `auth.uid()`. Nenhum endpoint aceita identificador de usuário (`user_id`), privilégio (`is_admin`), datas de concessão ou autoria a partir do navegador.

### 1.1 Verificação de Elegibilidade: `public.check_church_creation_eligibility()`
- **Objetivo:** Consultar no servidor se a conta conectada possui permissão para criar uma nova igreja.
- **Assinatura:**
  ```sql
  public.check_church_creation_eligibility()
  returns table (
      eligible boolean,
      reason text,
      active_admin_church_id uuid,
      active_admin_church_name text
  )
  ```
- **Campos retornados:**
  - `eligible` (`boolean`): indica se a conta pode prosseguir com a criação.
  - `reason` (`text`): código estruturado do motivo (`'eligible'`, `'already_admin'`, `'email_not_confirmed'`, `'anonymous_user'`, `'blocked'`, `'account_deleted'`).
  - `active_admin_church_id` (`uuid`): identificador da igreja que a conta já administra ativamente (quando `reason = 'already_admin'`).
  - `active_admin_church_name` (`text`): nome da igreja que a conta já administra ativamente (quando `reason = 'already_admin'`).
- **Critérios de elegibilidade avaliados:**
  1. Conta autenticada não nula (`auth.uid() IS NOT NULL`).
  2. Conta existente e não marcada como excluída (`deleted_at IS NULL` em `auth.users`).
  3. Não anônima (`is_anonymous IS NOT TRUE`).
  4. E-mail confirmado (`email_confirmed_at IS NOT NULL`).
  5. Sem bloqueio vigente (`banned_until IS NULL OR banned_until <= now()`).
  6. **Sem administração ativa em nenhuma igreja:** não possuir nenhum registro em `app_private.church_access` com `status = 'active'` e `is_admin = true`.
- **Ressalva de segurança:** A consulta de elegibilidade no cliente fornece feedback informativo rápido à interface. No entanto, a elegibilidade é obrigatoriamente revalidada de forma atômica dentro de `public.create_my_church`. Falha ao consultar elegibilidade não equivale a permissão.

---

### 1.2 Criação Atômica de Igreja: `public.create_my_church(...)`
- **Assinatura:**
  ```sql
  public.create_my_church(
      p_command_id uuid,
      p_name text,
      p_creator_name text,
      p_timezone text default 'America/Sao_Paulo',
      p_address text default null,
      p_google_maps_url text default null,
      p_default_duration_policy text default 'warn'
  )
  returns table (
      church_id uuid,
      church_name text,
      member_id uuid,
      display_name text,
      timezone text,
      default_duration_policy text,
      is_admin boolean,
      already_existed boolean
  )
  ```
- **Campos recebidos:**
  - `p_command_id`: UUID gerado pelo cliente para garantia de idempotência e reconciliação.
  - `p_name`: nome da igreja (1 a 160 caracteres).
  - `p_creator_name`: nome do criador para o seu cadastro de membro (1 a 120 caracteres).
  - `p_timezone`: fuso horário IANA válido (validado contra `pg_timezone_names`; padrão `'America/Sao_Paulo'`).
  - `p_address`: endereço físico (opcional, máximo 500 caracteres).
  - `p_google_maps_url`: link da localização no Google Maps (opcional, formato estrito `https://...`).
  - `p_default_duration_policy`: política padrão de duração das atividades (`'warn'` ou `'block'`, padrão `'warn'`).
- **Validações de entrada e normalização:**
  - Textos normalizados na forma canônica NFC via `pg_catalog.btrim(pg_catalog.normalize(texto, 'NFC'))`.
  - Preservação estrita de acentos, cedilhas e apóstrofos.
  - Validação estrita de limites de caracteres e preenchimento de campos obrigatórios.
  - Fuso horário validado em `pg_timezone_names`.
  - Política de duração restrita a `'warn'` ou `'block'`.
  - Validação de formato da URL do Google Maps por regex (`maps.app.goo.gl`, `goo.gl/maps`, `google.<tld>/maps`, `maps.google.<tld>/...`), sem requisição HTTP externa.
- **Ordem consistente de bloqueios e serialização:**
  - Bloqueio consultivo transacional por usuário: `pg_catalog.pg_advisory_xact_lock(hashtext('create_my_church_quota'), hashtext(v_user_id::text))`.
  - Serializa tentativas concorrentes da mesma conta, evitando corridas para criação simultânea ou consumo indevido de limites.
- **Idempotência e recuperação de replay:**
  - Calcula hash SHA-256 estruturado a partir de JSONB determinístico dos parâmetros, incluindo explicitamente o tipo de ação `'create_church'`, preservando separação estrita de limites de campos e diferenciação entre nulo e vazio:
    `sha256(jsonb_build_object('action', 'create_church', 'name', v_name, 'creator_name', v_creator_name, ...)::text::bytea)`.
  - Consulta `app_private.command_receipts` com chave `(church_id, user_id, command_id)` e `action = 'create_church'`:
    - **Replay com mesmos parâmetros:** revalida a identidade da conta e a existência do vínculo ativo atual antes de devolver os dados históricos com `already_existed = true`. Não restaura nem concede acesso a contas revogadas, inativadas ou bloqueadas.
    - **Replay com parâmetros divergentes:** rejeição estrita por violação de unicidade (`23505`).
- **Atomicidade da transação única:**
  Na mesma transação são gravados:
  1. Nova igreja em `app_private.churches`.
  2. Cadastro de membro do criador em `app_private.members` como primeiro administrador.
  3. Vínculo de acesso em `app_private.church_access` (`is_admin = true`, `status = 'active'`, `onboarding_completed_at = now()`, `granted_by = v_user_id`).
  4. Entrada de auditoria em `app_private.audit_entries` com `actor_user_id = v_user_id`, `actor_source = 'application'`, `action = 'create_church'`, `target_entity = 'churches'`, `details` em JSONB.
  5. Recibo de comando em `app_private.command_receipts` (`action = 'create_church'`, `params_hash`, `result_member_id`).
  - Qualquer falha (inclusive erro na auditoria ou violação do índice de administração única) desfaz integralmente todas as alterações (`ROLLBACK`).
- **Limite técnico de taxa:**
  - Máximo de 10 criações de igreja concluídas nas últimas 24 horas por usuário autenticado, aferidas em `app_private.command_receipts`.

---

### 1.3 Consulta de Recibo: `public.get_create_church_receipt(p_command_id uuid)`
- **Objetivo:** Reconciliar o resultado de uma criação de igreja quando ocorrer queda de conexão, interrupção física ou resposta incerta antes da confirmação pelo navegador.
- **Assinatura:**
  ```sql
  public.get_create_church_receipt(p_command_id uuid)
  returns table (
      church_id uuid,
      church_name text,
      member_id uuid,
      display_name text,
      timezone text,
      default_duration_policy text,
      is_admin boolean
  )
  ```
- **Autorização e Revalidação:**
  - Acesso exclusivo ao próprio recibo (`user_id = auth.uid()`).
  - Confere se o recibo pertence à ação `'create_church'`.
  - Revalida se a conta continua ativa, não excluída e não bloqueada, e se o vínculo com a igreja continua ativo e administrativo antes de devolver os dados.
- **Comportamento e reconciliação:**
  - Se o comando foi gravado no banco, retorna os dados da igreja criada e do membro.
  - Se a consulta falhar (erro de rede) ou retornar incompleta/vazia, isso **não** comprova que a criação foi descartada pelo banco. O cliente preserva o comando no `sessionStorage` e permite reexecução idempotente segura com o **mesmo** `command_id` e os parâmetros persistidos.

---

## 2. Regras e Salvaguardas no Banco de Dados

### 2.1 Limite de 1 Administração Ativa por Conta Auth
- **Garantia Física no Motor:**
  ```sql
  create unique index church_access_single_active_admin_idx
  on app_private.church_access (user_id)
  where (is_admin = true and status = 'active');
  ```
- **Regra de Negócio:**
  - Cada conta de usuário Auth pode ter administração ativa em no máximo uma igreja por vez.
  - Uma igreja pode ter vários usuários administradores ativos ao mesmo tempo. Não existe limite de um administrador por igreja.
  - O índice de unicidade restringe `user_id` nos vínculos administrativos ativos; não torna `church_id` único para esses vínculos.
  - Exemplos:
    - Usuário A admin da igreja X e usuário B também admin da igreja X é **permitido**.
    - Usuário A admin simultaneamente das igrejas X e Y é **bloqueado**.
  - Permite livremente que a mesma conta tenha múltiplos vínculos com `is_admin = false` (membro básico) em outras igrejas, ou vínculos inativos/revogados (`status <> 'active'`).

### 2.2 Continuidade Administrativa: Proteção do Último Administrador Elegível
Para assegurar que nenhuma igreja fique órfã de liderança administrativa:
1. **Serialização por Igreja via Advisory Lock:**
   Ambos os gatilhos adquirem bloqueio consultivo transacional ordenado por igreja:
   `pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(v_church_id::text))`
   Isso serializa modificações concorrentes que afetam a liderança daquela igreja, evitando deadlocks de linha e leituras sujas.
2. **Gatilho em `app_private.church_access` (`protect_last_active_admin`):**
   - Disparado antes de `UPDATE` ou `DELETE`.
   - Se o registro afetado for um administrador ativo (`OLD.is_admin = true AND OLD.status = 'active'`) e a operação pretender removê-lo, desativá-lo (`NEW.status <> 'active'`), revogar seu privilégio (`NEW.is_admin = false`) ou alterar seu `member_id`/`user_id`:
     - Verifica se existe pelo menos um **outro** administrador elegível para a mesma igreja:
       - Vínculo ativo com `is_admin = true` e `onboarding_completed_at IS NOT NULL`.
       - Membro associado em `members` com `status = 'active'`.
       - Conta Auth em `auth.users` não deletada, sem bloqueio vigente e com e-mail confirmado.
     - Se não existir sucessor elegível, a operação é abortada com exceção `P0001: Cannot remove, deactivate or revoke the last eligible active administrator of a church`.
3. **Gatilho em `app_private.members` (`protect_last_active_admin_member`):**
   - Disparado antes de `UPDATE` ou `DELETE` na tabela `members`.
   - Se o membro a ser removido ou desativado estiver vinculado a um `church_access` de administrador ativo:
     - Adquire o mesmo lock consultivo transacional na igreja.
     - Verifica se existe outro administrador elegível na igreja.
     - Se for o único, impede a desativação ou remoção física com a mesma exceção `P0001`.

---

## 3. Scripts de Instalação e Validação

Localizados em `docs/sql/`:

1. **`009_preflight_create_my_church.sql` (Somente leitura):**
   - Diagnostica previamente se existem contas com múltiplas administrações ativas duplicadas antes da criação do índice.
   - Confere se as 7 tabelas de `app_private` existem.
   - Verifica se a extensão `pgcrypto` está ativa.
   - Confere especificamente as colunas necessárias em `auth.users`, `churches`, `members`, `church_access`, `audit_entries` e `command_receipts`.
   - Confere se os novos objetos ainda não existem ou estão prontos para criação.

2. **`009_validate_create_my_church.sql` (Ensaio transacional com `ROLLBACK`):**
   - Utiliza blocos `BEGIN ... EXCEPTION ... END` válidos em PL/pgSQL (sem sintaxe externa).
   - Executa todas as etapas do DDL e DML em transação isolada de teste.
   - Testa sob authenticated com claims controladas, alternando para operador apenas para inspecionar fixtures da aplicação.
   - Testa a negativa para `anon` e `service_role` nas tabelas privadas de `app_private`.
   - Testa que uma igreja pode ter múltiplos administradores (usuário A e usuário B admins da igreja X).
   - Testa o bloqueio de uma conta administrar duas igrejas simultaneamente.
   - Testa a proteção do último administrador elegível e a permissão de saída quando há sucessor elegível.
   - Testa a validação e rejeição de URLs do Google Maps arbitrárias ou maliciosas.
   - Testa atomicidade com falha de auditoria e ausência de gravações parciais.
   - Finaliza obrigatoriamente com `ROLLBACK`, deixando a base intacta.

3. **`009_create_my_church.sql` (Instalação permanente com `COMMIT`):**
   - Cria o índice parcial `church_access_single_active_admin_idx` em `(user_id)`.
   - Cria as funções de trigger com serialização consultiva e verificação de elegibilidade do sucessor.
   - Cria as 3 funções RPC em `public`: `check_church_creation_eligibility`, `create_my_church` e `get_create_church_receipt`.
   - Configura `security definer`, `set search_path = ''` e `set statement_timeout = '5s'`.
   - Revoga privilégios de `public` e `anon`, concedendo execução estrita a `authenticated`.
   - Emite notificação `NOTIFY pgrst, 'reload schema'`.

4. **`010_verify_create_my_church.sql` (Verificação pós-instalação somente leitura):**
   - Confere unicidade (`ix.indisunique`), validade (`ix.indisvalid`) e expressão de predicado do índice parcial.
   - Confere se os 2 novos gatilhos estão habilitados (`tr.tgenabled = 'O'`) e associados às funções corretas.
   - Confere se as 3 novas RPCs existem com `prosecdef = true`, `statement_timeout = 5s` e privilégios concedidos exclusivamente a `authenticated`.
   - Confere a continuidade do bloqueio privado em `app_private`.

---

## 4. Experiência na Interface Web e Ciclo de Comandos

### 4.1 Pontos de Entrada e Contexto Estável
- **Tela de Acesso Pendente (`AccessPendingPage.jsx`):**
  - Usuários autenticados sem nenhum vínculo ativo recebem a consulta de elegibilidade.
  - Se houver comando pendente retido no `sessionStorage`, exibe card de recuperação e reconciliação mesmo que a elegibilidade retorne `already_admin` (pois a própria criação pode já ter sido confirmada no banco).
  - Distingue criação confirmada de falha ao recarregar acesso, oferecendo nova tentativa de carregamento sem reiniciar criação.
  - Subtítulo padronizado com a terminologia "primeiro administrador".
- **Tela Inicial da Igreja (`ChurchHomePage.jsx`):**
  - Para administradores ativos: exibe aviso sobre o limite de uma administração por conta.
  - Para membros básicos: consulta a **elegibilidade global** via RPC antes de oferecer a opção de criação; ser membro em uma igreja não comprova ausência de administração ativa em outra.
  - Se elegível: exibe a seção "Quer iniciar sua comunidade?" com o botão "Criar minha igreja".
  - Se for administrador em outra igreja: exibe aviso explicando o limite e identificando a igreja administrada.
  - Se a conta possuir múltiplos vínculos autorizados: exibe o botão "Trocar de comunidade" para alternar entre igrejas sem misturar contextos.
- **Seleção Estável de Contexto (`AuthContext.jsx`):**
  - Preserva a escolha explícita da igreja no `sessionStorage` sob `selected_church_<userId>`.
  - Revalida o contexto salvo contra os vínculos autorizados retornados pelo banco.
  - Se a igreja preferida/salva não for encontrada ou se houver múltiplos vínculos sem escolha explícita: **não** adota `data[0]` como fallback silencioso; aciona o estado `select_church` e exibe `SelectChurchPage.jsx` para escolha explícita (conforme PRD / M61).
  - Limpa e invalida estados de consultas e comandos do contexto anterior ao alternar de comunidade.

### 4.2 Formulário de Criação (`CreateChurchModal.jsx`)
- Apresenta os campos da arquitetura:
  - **Nome da igreja:** obrigatório, 1 a 160 caracteres.
  - **Nome do criador:** obrigatório, 1 a 120 caracteres. Pré-preenchido com sugestão visual derivada de `user_metadata.full_name` do Google (mantido visível e editável).
  - **Fuso horário IANA:** seletor com fusos do Brasil e internacionais, padrão `America/Sao_Paulo`.
  - **Endereço físico:** opcional, até 500 caracteres.
  - **Link do Google Maps:** opcional, com validação estrita de domínios permitidos (`maps.app.goo.gl`, `goo.gl/maps`, `google.<tld>/maps`, `maps.google.<tld>/...`).
  - **Política padrão de duração:** seleção explícita entre `warn` e `block`.
- **Acessibilidade e Foco:**
  - Foco inicial posicionado no primeiro campo do formulário.
  - Contenção de foco (focus trap) ciclando entre os elementos focáveis do modal com Tab / Shift+Tab.
  - Fechamento acessível via tecla ESC e via clique no backdrop externo.
  - Subtítulo padronizado com a terminologia "primeiro administrador".

### 4.3 Ciclo de Comandos no Cliente (`churchCommandService.js`)
- **Imutabilidade e Retenção do Comando:**
  - Persiste o comando com parâmetros normalizados no `sessionStorage` (`church_creation_cmd_<uid>`).
  - Impede a substituição silenciosa de um comando pendente por outro `commandId`.
  - Em retentativas (`dispatchChurchCreation`), utiliza integralmente os parâmetros persistidos no storage (`pendingCmd.churchData`), e **não** os valores eventualmente alterados no formulário do cliente.
- **Validação Estrita de Respostas:**
  - `data = [{}]` ou respostas sem os identificadores essenciais (`church_id`, `member_id`, `is_admin === true`) são classificadas como `UNCERTAIN` e **mantêm** o comando no storage.
  - Recibos incompletos (com apenas `church_id` ou sem confirmação de `is_admin: true`) são classificados como `RECEIPT_INCOMPLETE` e **mantêm** o comando no storage.
- **Limpeza Segura:**
  - Comandos pendentes são removidos apenas após confirmação válida da criação ou da consulta de recibo.
  - No logout ou troca de conta, o storage de comandos e de igreja selecionada é limpo para evitar contaminação entre contas.

---

## 5. Evidências, Limites de Validação e Status dos Testes

### 5.1 Testes Automatizados Locais
Executados com sucesso via Node.js nativo com o comando `npm.cmd test`:
- **Total:** **57 testes automatizados** distribuídos em **12 suítes** (100% de aprovação, 0 falhas).
- **Testes dedicados de criação de igreja e regressões (`test/church-command-cycle.test.js` — 24 testes):**
  1. *Normalização e validação de entrada:* conversão NFD para NFC, preservação de apóstrofos e cedilhas, rejeição de nomes em branco, validação de limites de comprimento, políticas aceitas (`warn`/`block`) e formato estrito de URL do Google Maps.
  2. *Classificação de erros:* separação de códigos Postgres definitivos (`23505`, `23514`, `P0001`, `42501`) e falhas de transporte/5xx como respostas incertas.
  3. *Ciclo de comandos e retenção:* persistência com isolamento por usuário, cancelamento do envio caso `sessionStorage` falhe, limpeza global no logout.
  4. *Elegibilidade no cliente:* identificação de conta elegível, conta administradora existente e tratamento de falhas.
  5. *Despacho e reconciliação:* ciclo de sucesso, preservação em respostas incertas, recuperação via recibo e proteção contra descarte prematuro do comando.
  6. *Regressões do Codex e contratos:*
     - `data=[{}]` não é classificado como sucesso, retorna `UNCERTAIN` e retém o comando no storage.
     - Retentativa de envio usa integralmente os parâmetros persistidos no storage, ignorando campos editados na tentativa.
     - Recibo contendo apenas `church_id` é classificado como `RECEIPT_INCOMPLETE` e retém o comando.
     - Validação estrita de URL do Google Maps rejeitando domínios maliciosos e URLs inseguras.
     - Imutabilidade do comando pendente impedindo sobrescrita de `commandId`.
- **Testes de ciclo de membros (`test/member-command-cycle.test.js` — 33 testes):**
  - Todas as 6 suítes continuam passando integralmente sem regressões.
- **Build de produção:**
  - Compilado com sucesso via `npm.cmd run build` (Vite v6.4.3 em 3.01s).

### 5.2 Limites de Evidência Declarados
- **Validação de Código de Produção vs Operação do Banco:**
  - Os 57 testes automatizados comprovam o ciclo no cliente, o comportamento dos serviços, a persistência no storage e o tratamento das respostas da RPC.
  - A validação executável do SQL (`009_validate_create_my_church.sql`) em um ambiente PostgreSQL dedicado ou com duas conexões simultâneas para validação física de concorrência em locks consultivos permanece como etapa operacional a ser conduzida pelo operador antes da aplicação permanente em produção.
  - Não foram executadas operações manuais no projeto Supabase remoto nem inseridas fixtures na base do piloto.
