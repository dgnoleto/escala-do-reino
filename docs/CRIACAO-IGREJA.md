# Criação de Igreja ("Criar minha igreja") e Salvaguardas de Administração

Incremento de produto implementando o fluxo “Criar minha igreja” para contas elegíveis, criação atômica no servidor, restrição no banco de no máximo uma administração ativa por conta Auth, proteção contra remoção/desativação do último administrador de uma igreja, ciclo de comandos idempotente no cliente e entrada segura na igreja recém-criada.

---

## 1. Contratos e Endpoints Públicos

As tabelas de `app_private` permanecem fechadas, fora dos esquemas expostos pela Data API, com RLS habilitada e sem privilégios diretos para `anon`, `authenticated` ou `service_role`. A interação para criação de igreja e salvaguardas ocorre exclusivamente por três funções RPC em `public`, qualificadas, com `security definer`, `search_path = ''`, `set statement_timeout = '5s'` e permissão de execução concedida somente ao papel `authenticated`.

A identidade do usuário é derivada exclusivamente de `auth.uid()`. Nenhum endpoint aceita identificador de usuário (`user_id`), privilégio (`is_admin`), datas de concessão ou autoria a partir do navegador.

### 1.1 Verificação de Elegibilidade: `public.check_church_creation_eligibility()`
- **Objetivo:** Consultar no servidor se a conta conectada possui permissão para criar uma igreja. Retorno vazio de `get_my_church_access` **não** comprova elegibilidade, pois uma conta pode já administrar uma igreja ativa sem que ela apareça na consulta contextual padrão.
- **Campos retornados:**
  - `eligible` (`boolean`): indica se a conta pode prosseguir com a criação.
  - `reason` (`text`): código estruturado do motivo caso não seja elegível (`'already_admin'`, `'email_not_confirmed'`, `'anonymous_user'`, `'blocked'`, `'account_deleted'`).
  - `managed_church_name` (`text`): nome da igreja que a conta já administra ativamente (quando `reason = 'already_admin'`).
  - `managed_church_id` (`uuid`): identificador da igreja que a conta já administra ativamente (quando `reason = 'already_admin'`).
- **Critérios de elegibilidade avaliados:**
  1. Conta autenticada não nula (`auth.uid() IS NOT NULL`).
  2. Conta existente e não marcada como excluída (`deleted_at IS NULL` em `auth.users`).
  3. Não anônima (`is_anonymous IS NOT TRUE`).
  4. E-mail confirmado (`email_confirmed_at IS NOT NULL`).
  5. Sem bloqueio vigente (`banned_until IS NULL OR banned_until <= now()`).
  6. **Sem administração ativa em nenhuma outra igreja:** não possuir nenhum registro em `app_private.church_access` com `status = 'active'` e `is_admin = true`.
- **Ressalva de segurança:** A consulta de elegibilidade no cliente fornece feedback informativo rápido à interface. No entanto, a elegibilidade é obrigatoriamente revalidada de forma transacional e atômica dentro de `public.create_my_church`. Falha ao consultar elegibilidade não equivale a permissão.

---

### 1.2 Criação Atômica de Igreja: `public.create_my_church(...)`
- **Assinatura:**
  ```sql
  public.create_my_church(
      p_command_id uuid,
      p_church_name text,
      p_creator_name text,
      p_timezone text default 'America/Sao_Paulo',
      p_address text default null,
      p_google_maps_url text default null,
      p_default_duration_policy text default 'warn'
  ) returns jsonb
  ```
- **Campos recebidos:**
  - `p_command_id`: UUID gerado pelo cliente para garantia de idempotência e retenção de resposta.
  - `p_church_name`: nome da igreja (1 a 160 caracteres).
  - `p_creator_name`: nome do criador para o seu cadastro de membro (1 a 120 caracteres).
  - `p_timezone`: fuso horário IANA válido (validado contra `pg_timezone_names`; padrão `'America/Sao_Paulo'`).
  - `p_address`: endereço físico (opcional, máximo 500 caracteres).
  - `p_google_maps_url`: link da localização no Google Maps (opcional, formato `https://...`).
  - `p_default_duration_policy`: política padrão de duração das atividades (`'warn'` ou `'block'`, padrão `'warn'`).
- **Validações de entrada e normalização:**
  - Textos normalizados na forma canônica NFC via `pg_catalog.btrim(pg_catalog.normalize(texto, 'NFC'))`.
  - Preservação estrita de acentos, cedilhas e apóstrofos.
  - Validação estrita de limites de caracteres e preenchimento de campos obrigatórios.
  - Fuso horário validado em `pg_timezone_names`.
  - Política de duração restrita a `'warn'` ou `'block'`.
- **Ordem consistente de bloqueios e serialização:**
  - Bloqueio consultivo transacional por usuário: `pg_advisory_xact_lock(hashtext('create_my_church_quota'), hashtext(v_user_id::text))`.
  - Serializa tentativas concorrentes da mesma conta, evitando corridas para criação simultânea ou consumo indevido de limites.
- **Idempotência e recuperação de replay:**
  - Calcula hash SHA-256 dos parâmetros (`church_name`, `creator_name`, `timezone`, `address`, `google_maps_url`, `default_duration_policy`).
  - Consulta `app_private.command_receipts` com chave `(church_id, user_id, command_id)` com `action = 'create_church'`:
    - **Mesma chave com mesmos parâmetros:** recupera o resultado da criação original (`church_id`, `member_id`, `already_existed = true`), preservando replays sem consumir quota nem duplicar cadastros.
    - **Mesma chave com parâmetros divergentes:** rejeição estrita com violação de unicidade (`23505`).
- **Atomicidade da transação única:**
  Na mesma transação são gravados:
  1. Nova igreja em `app_private.churches` (`id`, `name`, `timezone`, `address`, `google_maps_url`, `default_duration_policy`, `created_at`, `updated_at`).
  2. Cadastro de membro do criador em `app_private.members` (`church_id`, `id`, `display_name`, `status = 'active'`).
  3. Vínculo de acesso em `app_private.church_access` (`church_id`, `user_id`, `member_id`, `is_admin = true`, `status = 'active'`, `onboarding_completed_at = now()`, `granted_by = v_user_id`, `granted_at = now()`).
  4. Entrada de auditoria em `app_private.audit_entries` com `actor_user_id = v_user_id`, `actor_source = 'application'`, `action = 'create_church'`, `target_entity = 'churches'`, `details` em JSONB.
  5. Recibo de comando em `app_private.command_receipts` (`church_id`, `user_id`, `command_id`, `action = 'create_church'`, `params_hash`, `result_member_id`).
  - Qualquer falha (inclusive erro na auditoria ou violação do índice de administração única) desfaz integralmente todas as alterações (`ROLLBACK`).
  - Criar uma nova igreja não concede acesso a nenhuma igreja pré-existente.
- **Limite técnico de taxa:**
  - Máximo de 10 criações de igreja concluídas nas últimas 24 horas por usuário autenticado, aferidas em `app_private.command_receipts`.
- **Retorno da função (`jsonb`):**
  ```json
  {
    "church_id": "UUID",
    "church_name": "Nome da Igreja",
    "member_id": "UUID",
    "is_admin": true,
    "already_existed": false
  }
  ```

---

### 1.3 Consulta de Recibo: `public.get_create_church_receipt(p_command_id uuid)`
- **Objetivo:** Reconciliar o resultado de uma criação de igreja quando ocorrer queda de conexão, interrupção física ou resposta incerta antes da confirmação pelo navegador.
- **Autorização:** Acesso exclusivo ao próprio recibo (`user_id = auth.uid()`).
- **Comportamento e reconciliação:**
  - Se o comando foi gravado no banco, retorna os dados da igreja criada e do membro.
  - Se a consulta falhar (erro de rede) ou retornar vazia (recibo ainda não presente), isso **não** comprova que a criação foi descartada pelo banco. O cliente preserva o comando no `sessionStorage` e permite reexecução idempotente segura com o **mesmo** `command_id` e os **mesmos** parâmetros.

---

## 2. Regras e Salvaguardas no Banco de Dados

### 2.1 Limite de 1 Administração Ativa por Conta Auth
- **Garantia Física no Motor:**
  ```sql
  create unique index church_access_single_active_admin_idx
  on app_private.church_access (user_id)
  where (is_admin = true and status = 'active');
  ```
- **Propriedades:**
  - Um índice parcial exclusivo impede fisicamente que uma mesma conta (`user_id`) possua mais de uma linha com `is_admin = true` e `status = 'active'`.
  - Sobrevive a concorrência massiva de transações simultâneas.
  - Permite livremente que a mesma conta tenha múltiplos vínculos com `is_admin = false` (membro básico) em outras igrejas, ou vínculos inativos/revogados (`status <> 'active'`).

### 2.2 Continuidade Administrativa: Proteção do Último Administrador
Para assegurar que nenhuma igreja fique órfã de liderança administrativa:
1. **Gatilho em `app_private.church_access` (`protect_last_active_admin`):**
   - Disparado antes de `UPDATE` ou `DELETE`.
   - Se o registro afetado for um administrador ativo (`OLD.is_admin = true AND OLD.status = 'active'`) e a operação pretender removê-lo, desativá-lo (`NEW.status <> 'active'`) ou revogar seu privilégio (`NEW.is_admin = false`):
     - Verifica se existe pelo menos um **outro** vínculo administrativo ativo para a mesma igreja (`church_id = OLD.church_id AND id <> OLD.id AND is_admin = true AND status = 'active'`).
     - Se não existir, a operação é sumariamente abortada com exceção `P0001: Cannot remove, deactivate or revoke the last active administrator of a church`.
2. **Gatilho em `app_private.members` (`protect_last_active_admin_member`):**
   - Disparado antes de `UPDATE` ou `DELETE` na tabela `members`.
   - Se o membro a ser removido ou desativado (`NEW.status <> 'active'`) estiver vinculado a um `church_access` de administrador ativo da igreja:
     - Confere se existe outro membro que também seja administrador ativo naquela mesma igreja.
     - Se for o único, impede a desativação ou remoção física com a mesma exceção `P0001`.

---

## 3. Scripts de Instalação e Validação

Localizados em `docs/sql/`:

1. **`009_preflight_create_my_church.sql` (Somente leitura):**
   - Confere se as 7 tabelas de `app_private` existem.
   - Verifica se a extensão `pgcrypto` está ativa.
   - Confere se as colunas necessárias em `auth.users`, `churches`, `members`, `church_access` e `command_receipts` estão presentes.
   - Confere se os novos objetos (`church_access_single_active_admin_idx`, funções RPC e triggers) ainda não existem ou estão prontos para criação.

2. **`009_validate_create_my_church.sql` (Ensaio transacional com `ROLLBACK`):**
   - Executa todas as etapas do DDL e DML em transação isolada de teste.
   - Testa a verificação de elegibilidade (`check_church_creation_eligibility`).
   - Testa a criação atômica de igreja (`create_my_church`).
   - Testa a idempotência (mesmo comando e parâmetros retorna `already_existed = true` sem duplicar).
   - Testa a rejeição de comando com parâmetros divergentes (`23505`).
   - Testa o índice parcial `church_access_single_active_admin_idx` (rejeitando segunda administração ativa para o mesmo usuário).
   - Testa a trava de proteção do último administrador em `church_access` (impedindo desativação e deleção).
   - Testa a trava de proteção em `members` (impedindo desativação do membro do último admin).
   - Testa as validações de comprimento e fusos inválidos.
   - Finaliza obrigatoriamente com `ROLLBACK`, deixando a base intacta.

3. **`009_create_my_church.sql` (Instalação permanente com `COMMIT`):**
   - Cria o índice parcial `church_access_single_active_admin_idx`.
   - Cria as funções de trigger `app_private.tg_protect_last_active_admin` e `app_private.tg_protect_last_active_admin_member` e seus respectivos gatilhos.
   - Cria as 3 funções RPC em `public`: `check_church_creation_eligibility`, `create_my_church` e `get_create_church_receipt`.
   - Configura `security definer`, `set search_path = ''` e `set statement_timeout = '5s'`.
   - Revoga privilégios de `public` e `anon`, concedendo execução estrita a `authenticated`.
   - Emite notificação `NOTIFY pgrst, 'reload schema'`.

4. **`010_verify_create_my_church.sql` (Verificação pós-instalação somente leitura):**
   - Verifica se o índice parcial está ativo e com predicado correto.
   - Verifica se as 3 novas RPCs existem no catálogo `pg_proc` com `prosecdef = true` e `statement_timeout = 5s`.
   - Verifica se as permissões de execução estão concedidas exclusivamente a `authenticated`.
   - Verifica se os 2 novos gatilhos estão habilitados nas tabelas alvo.

> [!NOTE]
> Os scripts SQL foram projetados para aplicação manual controlada pelo responsável no SQL Editor do Supabase. O código da aplicação consome os contratos publicados.

---

## 4. Experiência na Interface Web e Ciclo de Comandos

### 4.1 Pontos de Entrada no Fluxo
- **Tela de Acesso Pendente (`AccessPendingPage.jsx`):**
  - Usuários autenticados sem nenhum vínculo ativo recebem a consulta automática de elegibilidade.
  - Se elegíveis, é apresentado o botão de destaque **"Criar minha igreja"**.
  - Se inelegíveis porque já administram outra igreja (`reason = 'already_admin'`), recebem aviso contextual claro explicando o limite de uma administração por conta e informando a igreja administrada.
  - Se inelegíveis por e-mail não confirmado (`email_not_confirmed`), recebem instrução para confirmar o endereço.
  - Estados de carregamento, falha de consulta com opção de tentar novamente e estado offline são tratados sem assumir permissão tácita.
- **Tela Inicial da Igreja (`ChurchHomePage.jsx`):**
  - Administradores visualizam um aviso explicativo discreto de que sua conta já possui uma administração ativa.
  - Membros comuns (com acesso básico não administrativo a uma igreja existente) visualizam o botão **"Criar minha igreja"**, permitindo que iniciem sua própria congregação mantendo o acesso de membro na igreja atual.

### 4.2 Formulário de Criação (`CreateChurchModal.jsx`)
- Apresenta os campos da arquitetura:
  - **Nome da igreja:** obrigatório, 1 a 160 caracteres.
  - **Nome do criador:** obrigatório, 1 a 120 caracteres. Pré-preenchido com sugestão visual derivada de `user_metadata.full_name` do Google (mantido visível e editável). Metadados não concedem identidade nem privilégios no servidor.
  - **Fuso horário IANA:** seletor com fusos do Brasil (`America/Sao_Paulo`, `America/Manaus`, `America/Fortaleza`, etc.) e internacionais, padrão `America/Sao_Paulo`.
  - **Endereço físico:** opcional, até 500 caracteres.
  - **Link do Google Maps:** opcional, validação de formato `https://...`.
  - **Política padrão de duração:** seleção explícita entre `warn` (aviso ao exceder o tempo) e `block` (bloqueio), com `warn` selecionado inicialmente como padrão do piloto.
- **Validação no Cliente e Acessibilidade:**
  - Normalização Unicode NFC no cliente antes do envio.
  - Bloqueio de submissão dupla enquanto a requisição estiver em trânsito.
  - Modal com fechamento acessível (ESC, clique no backdrop, foco contido).

### 4.3 Ciclo de Comandos no Cliente (`churchCommandService.js`)
- **Geração e Persistência do Comando:**
  - Gera `command_id` criptograficamente seguro via `crypto.randomUUID()`.
  - Salva o comando com os parâmetros normalizados no `sessionStorage` (`church_creation_cmd_<uid>`).
  - Se o storage estiver bloqueado ou falhar ao gravar, a chamada à RPC **não é realizada**, evitando comandos órfãos sem rastreabilidade de cliente.
- **Classificação de Respostas:**
  - **Rejeições definitivas:** erros de validação de dados (`23514`), violação de regras de negócio (`P0001`), conta inelegível (`42501`) ou HTTP 4xx. O comando é finalizado e o erro exibido.
  - **Respostas incertas:** erros de rede (`Failed to fetch`), status HTTP 5xx, timeouts de transporte ou respostas vazias. O comando é **retido** no `sessionStorage`.
- **Reconciliação e Reexecução:**
  - Quando há resposta incerta, a interface aciona a checagem de recibo (`get_create_church_receipt`).
  - Se o recibo confirmar a criação, o fluxo é concluído com sucesso.
  - Se a checagem falhar ou não encontrar o recibo, o usuário pode clicar em "Tentar novamente", enviando **exatamente o mesmo `command_id` e parâmetros**, permitindo que o servidor resolva a idempotência sem criar igrejas duplicadas.
- **Limpeza no Logout:**
  - Ao realizar logout ou troca de conta, `clearAllChurchCommandStorage` remove comandos pendentes para não vazar parâmetros para novos usuários da mesma máquina.

### 4.4 Entrada Segura na Igreja Criada
- Após confirmação válida da RPC (ou da reconciliação de recibo):
  - O comando pendente é removido do `sessionStorage`.
  - O modal aciona `refreshAccess({ preferredChurchId: result.church_id })`.
  - O `AuthContext` atualiza o estado local, selecionando imediatamente a nova igreja criada como contexto ativo e redirecionando o usuário como administrador da sua congregação.

---

## 5. Evidências, Limites de Validação e Status dos Testes

### 5.1 Testes Automatizados no Ambiente de Desenvolvimento
Executados com sucesso via Node.js nativo com o comando `npm.cmd test`:
- **Total:** **52 testes automatizados** distribuídos em **11 suítes** (100% de aprovação, 0 falhas).
- **Testes dedicados de criação de igreja (`test/church-command-cycle.test.js` — 19 testes):**
  1. *Normalização e validação de entrada:* conversão NFD para NFC, preservação de apóstrofos e cedilhas, rejeição de nomes em branco, validação de limites de comprimento (igreja 1-160, criador 1-120, endereço max 500), políticas aceitas (`warn`/`block`) e formato de URL do Google Maps.
  2. *Classificação de erros:* separação estrita entre códigos Postgres definitivos (`23505`, `23514`, `P0001`, `42501`) e falhas de transporte/5xx como respostas incertas.
  3. *Ciclo de comandos e retenção:* salvamento e leitura isolados por usuário, cancelamento do envio caso `sessionStorage` falhe, limpeza global no logout.
  4. *Elegibilidade no cliente:* tratamento de conta elegível, conta administradora existente (com identificação da igreja administrada) e garantia de que falha na consulta não presume permissão.
  5. *Despacho e reconciliação:* ciclo de sucesso, preservação em respostas incertas, recuperação via recibo e proteção contra descarte prematuro do comando pendente.
- **Testes de regressão de gestão de membros (`test/member-command-cycle.test.js` — 33 testes):**
  - Todas as 6 suítes continuam passando sem alterações.

### 5.2 Limites de Evidência Declarados
- **Validação de Código de Produção vs Operação do Banco:**
  - Os testes automatizados em JavaScript comprovam o comportamento do cliente, a persistência no storage e o tratamento de cenários simulados.
  - A garantia definitiva de concorrência, unicidade e atomicidade física depende dos mecanismos do PostgreSQL instalados pelos scripts SQL (`church_access_single_active_admin_idx`, `pg_advisory_xact_lock`, gatilhos de integridade e transações `SERIALIZABLE`/bloqueios de linha).
- **Validações Manuais no Navegador Real:**
  - O comportamento visual do modal, seletor de fuso e transição de tela foi validado localmente.
  - A execução dos scripts SQL (`009` e `010`) em produção/homologação no Supabase deve ser realizada manualmente pelo responsável pelo projeto.
