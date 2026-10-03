# Cadastro e Listagem de Membros na Web

Incremento de produto implementando o cadastro real de membros na web e listagem paginada por administrador autorizado na própria igreja, com autorização estrita no servidor, auditoria transacional e proteção contra repetição de comandos e resposta perdida.

## 1. Contratos e Endpoints Públicos

As tabelas de `app_private` permanecem fechadas, fora dos esquemas expostos pela Data API, com RLS habilitada e sem privilégios diretos para `anon`, `authenticated` ou `service_role`. O acesso à gestão de membros ocorre exclusivamente por três funções RPC em `public`, qualificadas, com `security definer`, `search_path = ''` e permissão de execução concedida somente ao papel `authenticated`.

### 1.1 Listagem de Membros: `public.list_church_members(p_church_id uuid, p_limit integer, p_offset integer)`
- **Objetivo:** Retornar lista paginada dos membros cadastrados na igreja informada.
- **Campos retornados:** `member_id` (UUID), `display_name` (texto), `status` (texto: `'active'` ou `'inactive'`), `created_at` (timestamptz), `total_count` (bigint).
- **Dados omitidos:** Nenhum dado pessoal adicional (sem CPF, telefone, e-mail ou endereço).
- **Limites de entrada:** `p_limit` delimitado no servidor entre 1 e 100 (padrão 20); `p_offset` `>= 0`. Timeout de execução de 5 segundos.
- **Autorização:** A identidade do chamador é obtida exclusivamente de `auth.uid()`. Exige conta confirmada, não excluída, não anônima e sem bloqueio vigente; exige vínculo `church_access` com `status = 'active'`, `onboarding_completed_at` preenchido e `is_admin = true`; exige igreja e cadastro de membro do administrador ativos. Se qualquer condição falhar, encerra com erro de privilégio insuficiente (`42501`).

### 1.2 Criação de Membro: `public.create_church_member(p_church_id uuid, p_command_id uuid, p_display_name text)`
- **Objetivo:** Criar um novo membro na igreja especificada com apenas o nome.
- **Campos recebidos:** `p_church_id`, `p_command_id` (UUID gerado pelo cliente para idempotência), `p_display_name`.
- **Validação de entrada:**
  - Nome textual não nulo, normalizado em NFC com espaços externos removidos via `btrim(normalize(p_display_name, NFC))`.
  - Limite estrito de 1 a 120 caracteres.
  - Preservação integral de acentos, cedilhas e apóstrofos.
  - Textos contendo fragmentos de sintaxe SQL são tratados puramente como dados literais.
- **Autorização e bloqueios:**
  - Valida o administrador na transação com ordem consistente de bloqueios: 1) `app_private.churches` `for share`; 2) `app_private.church_access` `for share`.
  - Rejeita qualquer tentativa de forjar autor, privilégio ou autoria a partir do navegador.
- **Proteção contra repetição e concorrência:**
  - Calcula resumo criptográfico SHA-256 dos parâmetros (`p_church_id` e nome normalizado).
  - Bloqueio consultivo de transação (`pg_advisory_xact_lock`) serializa chamadas simultâneas do mesmo usuário com o mesmo `command_id`.
  - Mesma chave com mesmos parâmetros: recupera o resultado original com `already_existed = true`, sem duplicar registro de membro nem de auditoria.
  - Mesma chave com parâmetros diferentes: rejeitada estritamente (`23505`).
  - Chaves diferentes com mesmo nome: permitidas (homônimos permitidos; nomes não são únicos).
- **Transação atômica:**
  - A criação do membro em `app_private.members`, a gravação da auditoria em `app_private.audit_entries` (ação `'create_member'`) e o recibo de comando em `app_private.command_receipts` ocorrem rigorosamente na mesma transação.
  - Qualquer falha desfaz integralmente todas as alterações (`ROLLBACK`).
- **Limitação de taxa compartilhada:**
  - Verificação de limite na rota efetiva: no máximo 30 criações de membros por minuto por usuário autenticado, baseada em `app_private.command_receipts`.

### 1.3 Consulta de Recibo: `public.get_create_member_receipt(p_church_id uuid, p_command_id uuid)`
- **Objetivo:** Reconciliar o resultado de uma criação quando houver queda de conexão ou resposta incerta antes da confirmação.
- **Comportamento:** Revalida autorização administrativa na igreja antes de consultar `app_private.command_receipts`. Se o comando foi gravado, retorna o membro correspondente; se não foi processado, retorna vazio, autorizando o reenvio seguro pelo cliente com a mesma chave.

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
   - O script cria fixtures temporárias, executa a bateria de testes sob o papel `authenticated` e encerra com `ROLLBACK`.
   - Exigir a linha final: `PASS: ensaio concluído; nenhuma alteração persistida.`

3. **Criação permanente com COMMIT:**
   - Somente após o ensaio anterior retornar `PASS`, executar inteiro `docs/sql/007_member_management.sql`.
   - O script cria a tabela `app_private.command_receipts`, as funções RPC em `public`, configura permissões e notifica o PostgREST para recarregar o schema.

4. **Verificação posterior somente leitura:**
   - Executar inteiro `docs/sql/008_verify_member_management.sql`.
   - Exigir que todas as colunas retornem `true`.

---

## 4. Limites de Evidência e Recomendações

- A preparação dos scripts e a compilação do código foram validadas no ambiente local de desenvolvimento.
- A execução efetiva do ensaio 007 e a instalação permanente no banco dependem da aplicação manual pelo responsável no Supabase.
- A proteção contra concorrência e idempotência foi estruturada no banco com bloqueios consultivos e restrição de unicidade; testes sob alta concorrência paralela distribuída permanecem dependentes de ensaios com múltiplas sessões reais.
- A limitação compartilhada de taxa de criação foi implementada diretamente na função RPC (nível banco); camadas perimetrais adicionais (Edge Functions / WAF) devem ser avaliadas antes da abertura em escala.
