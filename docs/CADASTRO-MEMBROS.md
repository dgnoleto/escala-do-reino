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
  - Calcula resumo criptográfico SHA-256 dos parâmetros (`p_church_id` e nome normalizado).
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
- **Timeout permanente:**
  - Timeout de execução de 5 segundos configurado na definição da função via `set statement_timeout = '5s'`.

### 1.3 Consulta de Recibo: `public.get_create_member_receipt(p_church_id uuid, p_command_id uuid)`
- **Objetivo:** Reconciliar o resultado de uma criação quando houver queda de conexão ou resposta incerta antes da confirmação.
- **Timeout permanente:** Configurado na definição da função via `set statement_timeout = '5s'`.
- **Comportamento e reconciliação:** Revalida autorização administrativa na igreja antes de consultar `app_private.command_receipts`.
  - Se o comando foi gravado, retorna o membro correspondente.
  - Se o recibo não for encontrado (retorno vazio), isso **não** comprova que a transação terminou sem gravação (pode haver transação em voo ou atraso). O cliente não descarta o comando nem exibe essa conclusão; em vez disso, autoriza a reexecução segura com o **mesmo** `command_id` e os **mesmos** parâmetros normalizados via `create_church_member`, cuja idempotência devolve o resultado original ou conclui uma única criação.

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

Os scripts em `docs/sql/` são preparados para execução manual no SQL Editor do projeto Supabase. Merge de código ou commits no Git não aplicam alterações no banco de dados.

### Sequência obrigatória:

1. **Pré-verificação somente leitura:**
   - Executar inteiro `docs/sql/007_preflight_member_management.sql`.
   - Exigir que todas as colunas retornem `true`. Se alguma for `false`, parar e revisar.

2. **Ensaio transacional com ROLLBACK:**
   - Executar inteiro `docs/sql/007_validate_member_management.sql`.
   - O script cria fixtures temporárias sob papel de manutenção, executa chamadas RPC como `authenticated` com JWT claims simuladas, valida atomicidade (inclusive falha intencional de auditoria revertendo membro e recibo), valida bloqueio de contas inelegíveis, valida limite técnico de taxa com replay preservado, e encerra com `ROLLBACK`.
   - Exigir a linha final: `PASS: ensaio concluído; nenhuma alteração persistida.`

3. **Criação permanente com COMMIT:**
   - Somente após o ensaio anterior retornar `PASS` e com autorização explícita, executar inteiro `docs/sql/007_member_management.sql`.
   - O script cria a tabela `app_private.command_receipts`, as funções RPC em `public`, configura permissões e notifica o PostgREST para recarregar o schema.

4. **Verificação posterior somente leitura:**
   - Executar inteiro `docs/sql/008_verify_member_management.sql`.
   - Exigir que todas as colunas retornem `true`.

5. **Testes no aplicativo web:**
   - Conferir listagem paginada e cadastro de membros na interface, validação de nomes acentuados, preservação de comando pendente em oscilação e reconciliação.

---

## 4. Limites de Evidência e Recomendações

- **Analisado estaticamente:** correção da chamada `normalize(..., 'NFC')`, checagem de privilégios (`REVOKE ALL`, `GRANT EXECUTE TO authenticated`), segurança `search_path = ''`, configuração de `statement_timeout = '5s'` e estrutura atômica de gravação. Não alegar execução em PostgreSQL quando houver apenas análise estática.
- **Testado isoladamente no ambiente de desenvolvimento:** bateria automatizada de testes locais em Node.js (`test/member-command-cycle.test.js`) com 18 cenários aprovados, cobrindo normalização NFC de caracteres compostos/decompostos, apóstrofos, espaços, limites de nome (1-120), classificação de erros definitivos vs respostas incertas do SDK, retenção de comando em falha de transporte sem exceção, retenção em exceções, tratamento de recibo vazio sem descartar comando, recuperação idempotente pós-gravação, persistência de comando pendente em desmontagem de tela, suporte a homônimos, isolamento estrito entre usuários/igrejas e prevenção de condições de corrida no `AuthContext` (descarte de `getSession` atrasado após `SIGNED_OUT`). Compilação de produção Vite (`npm run build`) concluída com sucesso.
- **Pendente no banco real Supabase:** a execução efetiva do preflight, do ensaio 007 com ROLLBACK e da aplicação permanente dependem de execução manual autorizada no SQL Editor do projeto. Testes de concorrência massiva com múltiplas conexões simultâneas reais não foram executados localmente e dependem de ambiente com sessões paralelas ativas.
- **Limitação de taxa:** os 30 cadastros/minuto por usuário são uma salvaguarda técnica do banco deste PR; proteções adicionais perimetrais (Edge Functions / WAF) devem ser implementadas antes da abertura em escala.
