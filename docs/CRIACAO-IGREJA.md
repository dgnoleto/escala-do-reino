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
  4. Entrada de auditoria em `app_private.audit_entries` com `actor_user_id = v_user_id`, `actor_source = 'application'`, `action = 'create_church'`, `target_type = 'church'`, `target_id = v_new_church_id`, `details` em JSONB.
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
   Isso serializa modificações concorrentes que afetam a liderança daquela igreja durante a transação, reduzindo disputas concorrentes de linha. Contudo, advisory locks não eliminam deadlocks por si sós em cenários de concorrência complexa sem ordenação global, e a comprovação física de concorrência exige execução operacional com duas conexões simultâneas (rodada coordenada com duas conexões físicas em READ COMMITTED já executada no laboratório local em 04/10/2026, conforme Seção 5; validações em outros níveis de isolamento e no ambiente do piloto permanecem pendentes).
2. **Gatilho em `app_private.church_access` (`protect_last_active_admin`):**
   - Disparado antes de `UPDATE` ou `DELETE`.
   - Se o registro afetado for um administrador ativo (`OLD.is_admin = true AND OLD.status = 'active'`) e a operação pretender removê-lo, desativá-lo (`NEW.status <> 'active'`), revogar seu privilégio (`NEW.is_admin = false`) ou alterar seu `member_id`/`user_id`:
     - Verifica se existe pelo menos um **outro** administrador elegível para a mesma igreja:
       - Vínculo ativo com `is_admin = true` e `onboarding_completed_at IS NOT NULL`.
       - Membro associado em `members` com `status = 'active'`.
       - Conta Auth em `auth.users` não deletada, sem bloqueio vigente e com e-mail confirmado.
     - Se não existir sucessor elegível, a operação é abortada com código de erro `23514`: `'Operação não permitida: a igreja não pode ficar sem administrador ativo elegível.'`.
3. **Gatilho em `app_private.members` (`protect_last_active_admin_member`):**
   - Disparado antes de `UPDATE` ou `DELETE` na tabela `members`.
   - Se o membro a ser removido ou desativado estiver vinculado a um `church_access` de administrador ativo:
     - Adquire o mesmo lock consultivo transacional na igreja.
     - Verifica se existe outro administrador elegível na igreja.
     - Se for o único, impede a desativação ou remoção física com o mesmo código de erro `23514`: `'Operação não permitida: não é possível desativar ou remover o membro do último administrador ativo elegível da igreja.'`.

---

## 3. Scripts de Instalação e Validação

Localizados em `docs/sql/`:

1. **`009_preflight_create_my_church.sql` (Somente leitura):**
   - Diagnostica previamente se existem contas com múltiplas administrações ativas duplicadas antes da criação do índice.
   - Confere se as 7 tabelas de `app_private` e as 4 RPCs anteriores existem.
   - O preflight atual não verifica a extensão `pgcrypto`; ele concentra sua validação prévia na ausência de administrações ativas duplicadas, integridade das 7 tabelas e presença das colunas essenciais.
   - Confere especificamente as colunas necessárias em `auth.users`, `churches`, `members`, `church_access`, `audit_entries` e `command_receipts`.
   - Confere se os novos objetos ainda não existem e confirma o isolamento estrito de `app_private`.
   - Executado no laboratório local e também no projeto do piloto (`jvpctgqudvjealzileib`) em 06/10/2026 com todas as 12 colunas retornando `true`.

2. **`009_validate_create_my_church.sql` (Ensaio transacional com `ROLLBACK`):**
   - Restrito a ambiente isolado dedicado para testes (local ou staging efêmero); executado com sucesso e resultado PASS com ROLLBACK no PostgreSQL 17.11 local em 04/10/2026; não deve ser executado no piloto sem estratégia de contas de teste definida e autorizada.
   - Utiliza blocos `BEGIN ... EXCEPTION ... END` válidos em PL/pgSQL.
   - Estrutura fixtures e inspeções administrativas como operador, alternando para `authenticated` via `SET LOCAL ROLE authenticated` com claims controladas para as RPCs, e retornando via `RESET ROLE` com asserções explícitas de `current_user`.
   - Não concede acesso direto a `app_private` para facilitar testes.
   - Testa a negativa para `anon` e `service_role` na execução das RPCs e em todas as tabelas de `app_private`.
   - Testa a criação atômica, idempotência via hash JSONB estruturado e replay com mesmos parâmetros.
   - Testa que uma igreja pode ter múltiplos administradores e bloqueio físico do índice para a mesma conta em duas igrejas.
   - Testa a proteção do último administrador elegível (erro `23514`) e saída permitida com sucessor elegível.
   - Testa a validação estrita de URLs do Google Maps no servidor (rejeitando subdomínios falsos como `google.exemplo.com/maps` e URLs arbitrárias).
   - Testa atomicidade com falha controlada de auditoria e ausência estrita de registros parciais em `churches`, `members`, `church_access` e `command_receipts`.
   - Finaliza obrigatoriamente com `ROLLBACK`, deixando a base intacta.

3. **`009_create_my_church.sql` (Instalação permanente com `COMMIT`):**
   - Instalado com autorização no laboratório local em 04/10/2026 e, em 06/10/2026, instalado com autorização expressa do responsável no banco de dados do piloto com COMMIT e mensagem PASS após confirmação (projeto `jvpctgqudvjealzileib`).
   - Cria o índice parcial `church_access_single_active_admin_idx` em `(user_id)`.
   - Cria as funções de trigger com serialização consultiva e verificação de elegibilidade do sucessor.
   - Cria as 3 funções RPC em `public`: `check_church_creation_eligibility`, `create_my_church` e `get_create_church_receipt`.
   - Configura `security definer`, `set search_path = ''` e `set statement_timeout = '5s'`.
   - Revoga privilégios de `public` e `anon`, concedendo execução estrita a `authenticated`.
   - Emite notificação `NOTIFY pgrst, 'reload schema'`.

4. **`010_verify_create_my_church.sql` (Verificação pós-instalação somente leitura):**
   - Executado após a instalação local em 04/10/2026 e após a instalação no piloto em 06/10/2026 (por leitura em solicitação separada), com todas as 7 asserções verdadeiras em ambos os ambientes.
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
- **Total:** **117 resultados registrados** em **23 suítes** (100% de aprovação, 0 falhas). Os seis arquivos versionados em `test/` contêm exatamente **116 testes automatizados** em **23 suítes**. O comando geral `npm.cmd test` (que executa `node --test`) descobre também o arquivo `tools/local-auth-test.js` pelo padrão `*test.js`, reportando-o como resultado adicional sem falhas. A execução explícita dos arquivos de teste via `node --test (Get-ChildItem test/*.test.js)` reporta exatamente 116 testes em 23 suítes.
- **Testes dedicados de criação de igreja e regressões (`test/church-command-cycle.test.js` — 35 testes, 8 suítes):**
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
  7. *Proteção contra respostas antigas, isolamento de sessão e recuperação acessível:*
     - Descarte de resposta em voo de comando A como `STALE_SESSION` após logout/retorno, preservando comando B intacto.
     - Consulta de recibo antiga descartada como `STALE_SESSION` sem remover novo comando.
     - `removePendingChurchCommand` bloqueia remoção com `expectedCommandId` divergente.
     - Recuperação acessível com acesso admin e reconciliação por recibo.
     - Preservação de contexto com múltiplos acessos selecionando a igreja criada.
     - Validação de Maps rejeitando subdomínios arbitrários.
     - **Regressão Codex — Envio com geração explícita:** descarta resposta como `STALE_SESSION` após invalidação global (`invalidateChurchCommandSession`).
     - **Regressão Codex — Recibo com geração explícita:** descarta recibo como `STALE_SESSION` após invalidação global.
     - **Simulação lógica do modal:** logout durante envio descarta callback, bloqueia `onSuccess` e preserva storage.
     - **Simulação lógica de parâmetros e retentativa em AccessPendingPage:** `refreshAccess(createdChurch.church_id)` recebe identificador textual direto, destino é a igreja criada e falha de recarga não re-executa criação.
- **Testes com Componentes de Produção e React Test Renderer (`test/church-components-real.test.js` — 7 testes, 1 suíte):**
  - Execução real dos componentes React de produção (`App`, `AuthProvider`, `useAuth`, `CreateChurchModal`) com React Test Renderer 18.3.1 e esbuild substituindo apenas o transporte Supabase por respostas controladas:
  1. *Modal real de produção:* logout no `AuthContext` durante RPC em voo descarta callback e bloqueia `onSuccess`.
  2. *App real de produção:* criação confirmada seguida de recarga de acesso bem-sucedida seleciona a igreja criada.
  3. *App real de produção:* criação confirmada com falha na recarga preserva confirmação visível na tela ativa (`AccessErrorPage`: "Sua igreja foi criada. Não foi possível carregar o acesso agora.") e retry na mesma tela revalida o acesso sem reenviar RPC de criação.
  4. *App real de produção:* logout durante espera ou erro de recarga limpa a confirmação e impede vazamento para a conta seguinte.
  5. *App real de produção (M61):* abrir seleção de igreja descarta consulta de contexto anterior ainda em voo (resposta atrasada contendo somente igreja A não fecha a tela de seleção nem restaura A automaticamente).
  6. *App real de produção (M61):* resposta de erro atrasada de consulta em voo é descartada sem fechar a tela de seleção nem transicionar para estado de erro.
  7. *App real de produção (M61):* seleção explícita da igreja B invalida consulta anterior da igreja A e confirma a nova escolha no storage e na tela montada.
- **Testes de ciclo de membros (`test/member-command-cycle.test.js` — 33 testes, 6 suítes):**
  - Todas as 6 suítes continuam passando integralmente sem regressões.
- **Testes de configuração do cliente Supabase (`test/supabase-client-config.test.js` — 25 testes, 5 suítes):**
  - Validação estrita de protocolo HTTPS em produção e desenvolvimento.
  - Validação estrita de loopback HTTP exclusivamente em DEV (`localhost`, `127.0.0.1`, `[::1]`).
  - Rejeição de loopback HTTP em produção (`import.meta.env.DEV = false`).
  - Rejeição estrita de hosts falsos (`localhost.evil.com`, `127.0.0.1.evil.com`, `evil-localhost.com`), IPs de rede LAN (`192.168.x`, `10.x`, `172.16.x`) e domínios remotos via HTTP.
  - Rejeição de URLs com credenciais embutidas e URLs malformadas.
  - Validação da chave pública anônima em integração com `isSupabaseConfigured`.
- **Testes das guardas de segurança da ferramenta de teste local (`test/local-auth-guard.test.js` — 10 testes, 1 suíte):**
  - Aprovação em ambientes válidos (127.0.0.1, localhost, IPv6 [::1]).
  - Bloqueio estrito quando `isDev` for `false`.
  - Bloqueio de origens de página fora de loopback.
  - Bloqueio de backend em portas divergentes de `54321`.
  - Bloqueio de backend em HTTPS ou com credenciais embutidas.
  - Bloqueio quando cliente não estiver configurado.
- **Testes de renderização segura do utilitário local de autenticação (`test/local-auth-render.test.js` — 6 testes, 2 suítes):**
  - Renderização segura da sessão de teste com `document.createElement`, atributos e `textContent`, prevenindo interpolação de HTML (`innerHTML`).
- **Build de produção:**
  - Compilado com sucesso via `npm.cmd run build` (Vite v6.4.3). Confirmação de que a pasta `tools/` e os arquivos de teste local não são incluídos no pacote de produção (`dist/`).

### 5.2 Ambiente de Laboratório Local e Ferramenta de Teste

Para viabilizar o teste local pontual contra a instância Supabase do laboratório (`http://127.0.0.1:54321`):
1. **Configuração Mínima do Cliente (`src/lib/supabaseClient.js`):**
   - Aceita HTTP estritamente para hostnames de loopback (`localhost`, `127.0.0.1` ou `::1`) e unicamente quando `import.meta.env.DEV` for `true`.
   - Utiliza análise de URL pelo construtor WHATWG `new URL` com comparação exata de hostname.
   - Em produção (`DEV = false`), preserva a exigência estrita de HTTPS.
   - Rejeita credenciais embutidas na URL, URLs malformadas, IPs de rede local privada e falsos hosts.
2. **Ferramenta Separada de Autenticação (`tools/local-auth-test.html` e `tools/local-auth-test.js`):**
   - Disponível apenas em desenvolvimento no endereço `http://127.0.0.1:3000/tools/local-auth-test.html`.
   - Opera fora da interface de produto, sem inclusão em `public/` e sem impacto no bundle de produção.
   - Executa guardas em runtime antes de qualquer chamada Auth: exige `DEV = true`, página em loopback e backend em `http://<loopback>:54321`.
   - Utiliza a instância real de `supabase` de `src/lib/supabaseClient.js` para persistir a sessão de teste no `localStorage` compartilhado da mesma origem.
   - Suporta cadastro (`signUp`) e login (`signInWithPassword`) manuais com e-mail `@example.com` e senha digitada pelo operador.
   - Não grava senhas, tokens ou dados sensíveis em arquivos, logs ou URLs.
   - Orienta verificação do Mailpit (`http://127.0.0.1:54324`) caso a confirmação de e-mail esteja ativada na instância.
   - **Ressalva de conformidade:** O utilitário local de teste viabiliza a obtenção de sessão no laboratório onde o Google OAuth está desabilitado; ele não substitui a validação do botão Google do piloto nem antecipa a implementação da tela de e-mail/senha de produto prevista no PRD 3.1.

### 5.3 Validações Executadas em Laboratório e no Piloto

- **Cobertura de Componentes React e Regressões:**
  - Os testes de componentes com React Test Renderer cobrem a montagem da árvore de componentes, efeitos, ciclos de vida de promessas, descarte de callbacks e transições entre rotas/telas (`AccessPendingPage` -> `checking_access` -> `access_error` -> `ChurchHomePage`), além de regressões M61 de descarte de consultas em voo.
  - Não são testes visuais em navegador DOM (como Cypress ou Playwright) com interação de cursor ou layout CSS físico, nem comprovam todos os fluxos reais de múltiplos vínculos sob tráfego HTTP.
- **Ensaio SQL 009 com ROLLBACK e Verificação pós-instalação 010 em Laboratório (04/10/2026):**
  - Execução no PostgreSQL 17.11 local (`supabase_db_EscalaReinoLab`) de `009_validate_create_my_church.sql` integral com `ON_ERROR_STOP`, concluído com `ROLLBACK` explícito e resultado PASS.
  - Conferências imediatas pós-rollback em novas conexões comprovando preflight com 12 colunas true, laboratório sem contas residuais e integridade das verificações 006 (9 colunas true) e 008 (8 colunas true) (registro local de revisão: `outputs/validacao-sql-local-009-4f830c9/RESULTADO-ENSAIO-009.md`).
  - Instalação permanente autorizada exclusiva no laboratório de `009_create_my_church.sql` com `COMMIT`, seguida da verificação `010_verify_create_my_church.sql` em nova conexão com 7 asserções verdadeiras (índice único, gatilhos de proteção, segurança das 3 RPCs e RLS das 7 tabelas) (registro local de revisão: `outputs/validacao-sql-local-009-4f830c9/RESULTADO-INSTALACAO-009.md`).
- **Rodada de Concorrência Coordenada com Duas Conexões Físicas em Laboratório (04/10/2026):**
  - Executada exclusivamente no laboratório local sobre os objetos 009 instalados, com duas conexões de clientes em `READ COMMITTED` e um observador somente leitura (registro local de revisão: `outputs/concorrencia-local-009/RESULTADO-RODADA.md`):
    1. *Mesma conta, comandos distintos:* conexão B aguarda advisory lock de A; após COMMIT de A, B retorna erro 42501 (limite de 1 administração ativa por conta). Uma única igreja criada; aprovação automática.
    2. *Mesmo comando e parâmetros:* B aguarda A e retorna os mesmos IDs com `already_existed = true`. Replay idempotente aprovado automaticamente.
    3. *Duas saídas administrativas:* A confirma saída; B retorna erro 23514 da proteção do último administrador. **Limitação registrada:** o resultado esperado foi conferido em mensagens e no estado do banco (A sem administração e B preservado), mas o executor original não registrou PASS automático completo em razão da ordem de entrega stdout/stderr via docker exec.
    4. *Saída administrativa e desativação de membro:* B é bloqueado com 23514 da função de proteção de membro, mantendo o membro B ativo e administrador.
  - Limite de evidência: valida os 4 escalonamentos coordenados testados em `READ COMMITTED`; não é prova de todos os níveis de isolamento nem de toda concorrência possível.
- **Ensaio Controlado de Recuperação e Reconciliação por Recibo em Laboratório (05/10/2026, commit `b566185`):**
  - Conduzido pelo Codex em ambiente local isolado (EscalaReinoLab) com conta sintética autorizada (`pastor.recuperacao.pr7@example.com`):
    1. *Bloqueio antes do envio:* envio interrompido no transporte antes de chamar a rede; a aplicação apresentou "Envio anterior não confirmado" e manteve os dados do formulário; a consulta de recibo indicou registro ainda não encontrado; leitura independente do PostgreSQL em transação somente leitura confirmou 0 igrejas, membros, vínculos, recibos ou auditorias gravados.
    2. *Perda de confirmação após resposta real:* reenvio do formulário reutilizou o mesmo `command_id` (`8251abd6-53f2-40f3-88e7-c5735492f411`); a RPC `create_my_church` foi executada com sucesso no backend, retornando vínculo e privilégio administrativo; a confirmação foi descartada no transporte antes do aplicativo; o aplicativo permaneceu em estado incerto. Leitura somente leitura do banco confirmou exatamente 1 igreja, 1 membro, 1 vínculo ativo administrativo (`is_admin=true`), 1 recibo e 1 auditoria correlacionados.
    3. *Recuperação via recibo:* acionamento exclusivo de "Verificar no servidor" executou a reconciliação (o serviço JavaScript `checkChurchReceipt` consulta a RPC `public.get_create_church_receipt(p_command_id uuid)`), recuperou a criação, selecionou a igreja correta e exibiu perfil Administrador; recarga da página manteve o acesso; a tela Gestão de Membros exibiu 1 membro ativo sem duplicação de registros. Nova leitura somente leitura confirmou a persistência íntegra sem duplicação de registros (registro local de revisão: `outputs/teste-recuperacao-pr7-2026-10-05/RESULTADO-ENSAIO.md`).
- **Instalação e Verificação no Banco de Dados do Piloto (06/10/2026):**
  - No projeto Supabase do piloto (`jvpctgqudvjealzileib`), pré-voo `009_preflight_create_my_church.sql` concluído com 12 indicadores true (registro local: `outputs/preflight-piloto-pr7-2026-10-06/RESULTADO.md`).
  - Execução permanente autorizada expressamente pelo responsável de `009_create_my_church.sql` com COMMIT e mensagem PASS após confirmação (SHA256: `D0E735E4694FD1022AB778E51505ADAD5BC91FB524B2DA6B805023F101E08AEC`). Foram instalados o índice parcial único `church_access_single_active_admin_idx`, as duas funções e dois gatilhos de proteção do último administrador, e as três RPCs do produto em `public` (`check_church_creation_eligibility`, `create_my_church` e `get_create_church_receipt`).
  - Verificação `010_verify_create_my_church.sql` executada por leitura em solicitação separada após o sucesso do 009 com 7 indicadores true (SHA256: `63751AFB50504EC30E93EBAE198F2941CE78EF737F304F0428F55A7CA36EE91F`; registro local: `outputs/instalacao-piloto-pr7-2026-10-06/RESULTADO-INSTALACAO.md`).
  - O banco do piloto passou a contar com **sete funções RPC** do produto em `public` com permissão concedida a `authenticated` (as quatro anteriores mais as três novas) e as **sete tabelas internas** em `app_private` preservadas com RLS e bloqueio direto.
- **Conferência Manual no Aplicativo com Conta Existente do Piloto (06/10/2026):**
  - O responsável acessou a aplicação web local apontada para o backend do piloto e confirmou manualmente: exibição correta da igreja Ministério Shalom, perfil Administrador, quatro membros cadastrados ativos, botão Atualizar da lista mantendo os dados, e logout/novo login recuperando integralmente o acesso e os dados. Ação "Criar minha igreja" ausente para a conta que já administra uma igreja e aviso do limite de 1 administração por conta visível conforme PRD. Na navegação atual, recarga do navegador (F5) na tela de membros retorna à tela inicial da igreja com o botão de acesso a membros preservado (a subview é mantida em memória; registro local: `outputs/teste-aplicativo-piloto-2026-10-06/RESULTADO.md`). Identificado como teste manual informado pelo responsável, não como automação de navegador ou auditoria completa de OAuth/SMTP/identidades.

### 5.4 Validações Pendentes no Piloto ou Não Cobertas

- Criação positiva de nova igreja no piloto com conta elegível (a criação atômica e recuperação via recibo foram validadas no laboratório local isolado; a conta do piloto já possui administração ativa e testou a consulta e as salvaguardas);
- Desconexão física da rede;
- Cancelamento operacional por timeout via API HTTP;
- Google OAuth e fluxo de entrega/confirmação real de e-mails do piloto;
- Não houve merge do PR #7 nem publicação externa do frontend;
- Conformidade integral dos 64 cenários M01–M64 do PRD. As regressões de seleção de contexto em componentes de produção (`test/church-components-real.test.js`) demonstram o descarte de requisições defasadas e transição de telas, mas não comprovam todos os fluxos reais de múltiplos vínculos sob tráfego HTTP.
