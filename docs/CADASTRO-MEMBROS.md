# Cadastro e Listagem de Membros na Web

Incremento de produto implementando o cadastro real de membros na web e listagem paginada por administrador autorizado na própria igreja, com autorização estrita no servidor, auditoria transacional e proteção contra repetição de comandos e resposta perdida.

## 1. Contratos e Endpoints Públicos

As tabelas de `app_private` permanecem fechadas, fora dos esquemas expostos pela Data API, com RLS habilitada e sem privilégios diretos para `anon`, `authenticated` ou `service_role`. O acesso à gestão de membros ocorre exclusivamente por três funções RPC em `public`, qualificadas, com `security definer`, `search_path = ''` e permissão de execução concedida somente ao papel `authenticated`.

### 1.1 Listagem de Membros: `public.list_church_members(p_church_id uuid, p_limit integer, p_offset integer)`
- **Objetivo:** Retornar lista paginada dos membros cadastrados na igreja informada.
- **Campos retornados:** `member_id` (UUID), `display_name` (texto), `status` (texto: `'active'` ou `'inactive'`), `created_at` (timestamptz), `total_count` (bigint).
- **Dados omitidos:** Nenhum dado pessoal adicional (sem CPF, telefone, e-mail ou endereço).
- **Limites de entrada:** `p_limit` delimitado no servidor entre 1 e 100 (padrão 20); `p_offset` `>= 0`. Timeout de execução de 5 segundos configurado na definição da função via `set statement_timeout = '5s'`.
- **Autorização:** A identidade do chamador é obtida exclusivamente de `auth.uid()`. Exige conta confirmada, não excluída, não anônima e sem bloqueio vigente; exige vínculo `church_access` com `status = 'active'`, `onboarding_completed_at` preenchido e `is_admin = true`; exige igreja e cadastro de membro do administrador ativos. Se qualquer condição falhar, encerra com erro de privilégio insuficiente (`42501`).

### 1.2 Criação de Membro: `public.create_church_member(p_church_id uuid, p_command_id uuid, p_display_name text)`
- **Objetivo:** Criar um novo membro na igreja especificada com apenas o nome.
- **Campos recebidos:** `p_church_id`, `p_command_id` (UUID gerado pelo cliente para idempotência), `p_display_name`.
- **Validação de entrada:**
  - Nome textual não nulo, normalizado em NFC com espaços externos removidos via `pg_catalog.btrim(pg_catalog.normalize(p_display_name, 'NFC'))`.
  - Limite estrito de 1 a 120 caracteres.
  - Preservação integral de acentos, cedilhas e apóstrofos.
  - Textos contendo fragmentos de sintaxe SQL são tratados puramente como dados literais.
- **Autorização e bloqueios:**
  - Valida o administrador na transação com ordem consistente de bloqueios: 1) `app_private.churches` `for share`; 2) `app_private.church_access` `for share`; 3) Bloqueio consultivo de quota do usuário.
  - Rejeita qualquer tentativa de forjar autor, privilégio ou autoria a partir do navegador.
- **Proteção contra repetição, concorrência e preservação do replay:**
  - Calcula resumo criptográfico SHA-256 dos parâmetros (`p_church_id` e nome normalizado) — hash dos parâmetros para validação de idempotência.
  - Bloqueio consultivo de transação (`pg_advisory_xact_lock(hashtext('create_church_member_quota'), hashtext(v_user_id::text))`) serializa decisões de quota e criação entre chamadas do mesmo usuário, evitando que comandos concorrentes ultrapassem o limite.
  - Verificação de recibo existente é executada prioritariamente antes de verificar ou consumir quota:
    - Mesma chave com mesmos parâmetros: recupera o resultado original com `already_existed = true`, sem consumir quota nem duplicar registros. Replays são preservados mesmo com a quota de novas criações cheia.
    - Mesma chave com parâmetros diferentes: rejeitada estritamente (`23505`).
    - Chaves diferentes com mesmo nome: permitidas (homônimos permitidos; nomes não são únicos).
- **Transação atômica:**
  - A criação do membro em `app_private.members`, a gravação da auditoria em `app_private.audit_entries` (ação `'create_member'`) e o recibo de comando em `app_private.command_receipts` ocorrem rigorosamente na mesma transação.
  - Qualquer falha (inclusive erro na gravação da auditoria) desfaz integralmente todas as alterações (`ROLLBACK`).
- **Limitação técnica de taxa compartilhada:**
  - Escolha técnica deste PR: máximo de 30 criações concluídas por minuto por usuário autenticado, baseada em `app_private.command_receipts`. Não constitui regra aprovada de negócio.
  - Ressalva de segurança: a contagem de recibos concluídos no banco limita gravações efetivas, mas não substitui proteção contra chamadas abusivas que falham antes do commit ou tentativas de negação de serviço. Camadas perimetrais adicionais (Edge Functions / WAF) continuam recomendadas.
- **Configuração de timeout:**
  - Timeout de execução de 5 segundos configurado na definição da função via `set statement_timeout = '5s'`. Trata-se de configuração no catálogo do banco (`pg_proc.proconfig`); a comprovação operacional de cancelamento em tempo real pela API HTTP sob carga ou bloqueios externos permanece como validação pendente no ambiente de homologação.

### 1.3 Consulta de Recibo: `public.get_create_member_receipt(p_church_id uuid, p_command_id uuid)`
- **Objetivo:** Reconciliar o resultado de uma criação quando houver queda de conexão ou resposta incerta antes da confirmação.
- **Configuração de timeout:** Configurado na definição da função via `set statement_timeout = '5s'`.
- **Comportamento e reconciliação:** Revalida autorização administrativa na igreja antes de consultar `app_private.command_receipts`.
  - Se o comando foi gravado, retorna o membro correspondente.
  - Se a consulta falhar (erro de rede ou servidor) ou retornar vazio (recibo não encontrado), isso **não** comprova que a transação terminou sem gravação. O cliente **não** descarta o comando nem exibe essa conclusão; em vez disso, preserva o `command_id` e os dados no `sessionStorage` e autoriza a reexecução segura com o **mesmo** `command_id` e os **mesmos** parâmetros normalizados via `create_church_member`, cuja idempotência devolve o resultado original ou conclui uma única criação.

---

## 2. Decisão do Responsável: Exclusão Lógica e Histórico

Conforme nova decisão explícita do responsável pelo projeto:
1. **Decidido:**
   - Exclusões de cadastros da aplicação devem ser lógicas e recuperáveis, preservando identificadores, integridade referencial e histórico.
   - O fluxo operacional de produto não deve apagar fisicamente um membro para removê-lo da operação.
2. **Pendente para o próximo incremento:**
   - Avaliação da relação com o status `active` / `inactive` já existente na tabela `members`, evitando criar dois mecanismos redundantes (como `deleted_at` concorrendo com `status = 'inactive'`).
   - Definição da representação física definitiva, autorização, efeitos sobre convites, vínculos de acesso e escalas futuras, além do procedimento administrativo de recuperação.
   - Não foram adicionados neste incremento `deleted_at`, novos estados ou comandos de exclusão/restauração.
3. **Distinção de entidades:**
   - Membro, conta Auth e vínculo de acesso são entidades distintas. A exclusão lógica de um membro não apaga contas do Supabase Auth nem restaura automaticamente acessos revogados.
   - Esta decisão de integridade de produto não substitui a política separada de retenção do histórico e logs técnicos.

---

## 3. Aplicação Manual dos Scripts SQL

Os scripts em `docs/sql/` são preparados para execução manual no SQL Editor do projeto Supabase. Merge de código ou commits no Git não aplicam alterações no banco de dados. A execução manual depende de autorização expressa do responsável.

### Sequência única de validação manual:

1. **Pré-verificação somente leitura:**
   - Executar inteiro `docs/sql/007_preflight_member_management.sql`.
   - Exigir que todas as colunas retornem `true`. Se alguma for `false`, parar e revisar.

2. **Ensaio transacional com ROLLBACK:**
   - Executar inteiro `docs/sql/007_validate_member_management.sql`.
   - O script cria fixtures temporárias sob papel de manutenção, executa chamadas RPC como `authenticated` com JWT claims simuladas, valida atomicidade (inclusive falha intencional de auditoria revertendo membro e recibo), valida bloqueio de contas inelegíveis, valida limite técnico de taxa com replay preservado, e encerra com `ROLLBACK`.
   - Exigir a linha final: `PASS: ensaio concluído; nenhuma alteração persistida.`
   - O encerramento confere a ausência dos objetos temporários e das fixtures de ensaio (`Igreja Ensaio A`, `Igreja Ensaio B`), sem exigir ausência de membros ou igrejas preexistentes no banco.

3. **Criação permanente com COMMIT:**
   - Somente após o ensaio anterior retornar `PASS` e mediante autorização explícita do responsável, executar inteiro `docs/sql/007_member_management.sql`.
   - O script cria a tabela `app_private.command_receipts`, as funções RPC em `public`, configura permissões e notifica o PostgREST para recarregar o schema.

4. **Verificação posterior somente leitura:**
   - Executar inteiro `docs/sql/008_verify_member_management.sql`.
   - Exigir que todas as colunas retornem `true` (incluindo a configuração `statement_timeout=5s`).

5. **Testes no aplicativo web:**
   - Conferir listagem paginada (sem busca) e cadastro de membros na interface, validação de nomes acentuados, preservação de comando pendente em recarga/oscilação e reconciliação.

---

## 4. Limites de Evidência e Status dos Testes

- **Testes automatizados que executam código de produção (`test/member-command-cycle.test.js`):**
  - Executam diretamente as funções compartilhadas de produção importadas de `src/utils/memberCommandService.js` (utilizadas por `MembersPage.jsx` e `AuthContext.jsx`):
    - `validateAndNormalizeMemberName`: validação e normalização Unicode NFC (acentos, apóstrofos, limites de 1-120 caracteres, rejeição de vazios).
    - `savePendingMemberCommand`, `loadPendingMemberCommand`, `removePendingMemberCommand`: isolamento por usuário e igreja no `sessionStorage`.
    - `determineAuthTransition`: diferenciação entre restauração inicial da mesma conta (preservando o comando salvo) e troca efetiva de conta/logout (limpando o storage com `clearAllMemberCommandStorage`).
    - `isDefinitiveServerError` e `isUncertainResponse`: classificação de erros definitivos vs incertos (transporte, timeouts, 5xx, payloads inválidos).
    - `classifyReceiptCheckResult`: garantia de que consultas vazias ou falhas de rede/servidor na checagem de recibo não descartam o comando pendente, preservando-o para reexecução.
  - Resultado: 18 testes automatizados executados e aprovados com 100% de sucesso via Node.js nativo (`npm test`).
  - Compilação de produção Vite (`npm run build`) concluída com sucesso (0 erros, 0 avisos).

- **Analisado estaticamente:**
  - Correção da sintaxe `pg_catalog.normalize(p_display_name, 'NFC')`.
  - Configuração de `statement_timeout = '5s'` em `pg_proc.proconfig`.
  - Isolamento de papéis e simulação de revogação válida em `007_validate_member_management.sql`.
  - Não alegar execução em PostgreSQL quando houver apenas análise estática.

- **Validações que permanecem pendentes no banco real Supabase:**
  - Aplicação manual autorizada dos scripts SQL no Supabase SQL Editor.
  - Comprovação operacional de aborto por timeout de 5 segundos via API HTTP sob transações lentas.
  - Concorrência massiva real com múltiplas conexões paralelas simultâneas disputando o advisory lock transacional `pg_advisory_xact_lock`.
  - Integração ponta a ponta com a API do Supabase em rede real.
