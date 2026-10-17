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

## 2. Decisão do Responsável: Exclusão Lógica, Cadastro e Histórico

Conforme decisões explícitas do responsável pelo projeto:

1. **Cadastro de Membros apenas por Nome:**
   - O cadastro básico de membro coleta **apenas o nome** (`display_name`), sem CPF. O formulário atual de cadastro não possui campo de e-mail (nem obrigatório, nem opcional).
   - Cadastros de membros sem conta de login continuam plenamente permitidos para compor equipes e escalas.
   - O e-mail do destinatário será informado posteriormente, apenas no fluxo de emissão do convite de acesso à igreja.

2. **Exclusão Lógica e Recuperabilidade:**
   - Remoções de cadastros pela aplicação devem ser lógicas e recuperáveis, preservando identificadores (`member_id`), histórico e integridade referencial com escalas, ministérios e auditoria.
   - O fluxo operacional de produto não deve apagar fisicamente um registro para removê-lo da operação.
   - A recuperação de um cadastro logicamente excluído exige autorização administrativa explícita e registro na auditoria.
   - Restaurar um membro não restaura automaticamente seu vínculo de acesso anterior (`church_access`).
   - A exclusão lógica de um membro vinculado à administração **não pode contornar a proteção do último administrador**: o último administrador ativo de uma igreja não pode ser excluído ou desativado sem que outro administrador elegível assuma previamente.

3. **Pendências registradas antes do incremento de exclusão lógica (histórico da etapa 4):**
   - No registro original, estava pendente a avaliação da relação com o status `active` / `inactive` já existente na tabela `members`, evitando criar mecanismos redundantes (como `deleted_at` concorrendo com `status = 'inactive'`).
   - O incremento separado da etapa 4, após criação de igreja e convites, adotou `active`/`inactive` e foi validado no laboratório conforme a seção 5. Revisão e integração final ainda pendentes; isso não libera o piloto.
   - A limpeza de fixtures dos ensaios e scripts SQL (`007_validate_member_management.sql`) permanece com rollback/remoção transacional das fixtures de teste e não deve ser alterada.

4. **Distinção de entidades:**
   - Membro, conta Auth e vínculo de acesso são entidades distintas. A exclusão lógica de um membro não apaga contas do Supabase Auth nem restaura automaticamente acessos revogados.
   - Esta decisão de integridade de produto não substitui a política separada de retenção do histórico e logs técnicos.

---

## 3. Registro da Aplicação dos Scripts SQL (Etapa Concluída)

Conforme informado pelo responsável pelo projeto, a aplicação dos scripts em `docs/sql/` para gestão de membros foi realizada e concluída no SQL Editor do projeto Supabase:

1. **Pré-verificação somente leitura (`007_preflight_member_management.sql`):** concluída com todas as colunas retornando `true`.
2. **Ensaio transacional com ROLLBACK (`007_validate_member_management.sql`):** concluído com resultado `PASS: ensaio concluído; nenhuma alteração persistida.`, validando atomicidade, bloqueio de contas inelegíveis, preservação de replay e limite técnico de taxa.
3. **Criação permanente com COMMIT (`007_member_management.sql`):** instalação autorizada e executada com sucesso, criando a tabela `app_private.command_receipts`, as funções RPC em `public` (`list_church_members`, `create_church_member`, `get_create_member_receipt`), permissões de execução e notificação ao PostgREST.
4. **Verificação posterior somente leitura (`008_verify_member_management.sql`):** concluída com todas as asserções retornando `true` (incluindo `statement_timeout = 5s`).

**Estado atual informado:** o banco contempla **sete tabelas internas** em `app_private` e **sete funções RPC de produto** em `public` acessíveis pela Data API com o papel `authenticated` (com a instalação de `009_create_my_church.sql` e verificação `010` concluídas com sucesso no projeto piloto em 06/10/2026). Não repetir os scripts de instalação já concluídos (001 a 010). Esses resultados são registrados como evidências informadas pelo responsável, sem constituir nova inspeção direta do Supabase neste incremento.

---

## 4. Limites de Evidência e Status dos Testes

- **Controle de Idempotência e Limites no Servidor:**
  - O controle definitivo de idempotência (unicidade de recibos, cálculo SHA-256 dos parâmetros, recuperação de `already_existed = true` e serialização por `pg_advisory_xact_lock`) reside integralmente nas funções PL/pgSQL do banco de dados. Os testes locais em JavaScript/Node.js validam a coordenação do ciclo de comando e a classificação de respostas pelo cliente, sem constituir comprovação completa do sistema distribuído em operação real.

- **Testes automatizados que executam código de produção (`test/member-command-cycle.test.js`):**
  - Executam diretamente as funções compartilhadas de produção importadas de `src/utils/memberCommandService.js` (utilizadas por `MembersPage.jsx` e `AuthContext.jsx`):
    - `validateAndNormalizeMemberName`: validação e normalização Unicode NFC (acentos, apóstrofos, limites de 1-120 caracteres, rejeição de vazios).
    - `savePendingMemberCommand`, `loadPendingMemberCommand`, `removePendingMemberCommand`: isolamento por usuário e igreja no `sessionStorage`.
    - `dispatchMemberCreation`: ciclo completo de despacho, comprovação de que a persistência do comando no storage é verificada antes do envio (cancelando a RPC se falhar) e validação direta de 6 cenários com respostas controladas da RPC.
    - `determineAuthTransition`: diferenciação entre restauração inicial da mesma conta (preservando o comando salvo) e “troca efetiva de conta” / logout (limpando o storage com `clearAllMemberCommandStorage`).
    - `isDefinitiveServerError` e `isUncertainResponse`: classificação de erros definitivos vs incertos (transporte, timeouts, 5xx, payloads inválidos).
    - `classifyReceiptCheckResult`: garantia de que consultas vazias ou falhas de rede/servidor na checagem de recibo não descartam o comando pendente, preservando-o para reexecução com a mesma chave.
    - `applyMemberListTransition`, `getMemberListViewState`, `formatListErrorMessage`, `createListRequestCoordinator`: coordenação dos estados de listagem e proteção contra concorrência via sequência estritamente monotônica sem reutilização de identificadores após `reset()`.
  - Resultado: **33 testes automatizados** distribuídos em **6 suítes**, executados e aprovados com 100% de sucesso via Node.js nativo (`npm.cmd test`). Constituem evidência dos testes automatizados existentes para o ciclo de cliente, sem alegar cobertura integral do aplicativo ou prova de concorrência massiva no banco.

- **Evidências confirmadas pelo responsável no navegador e validações pendentes:**
  - **Evidências confirmadas:** o responsável confirmou no navegador o funcionamento do cadastro e da listagem de membros, a preservação dos quatro membros na tela durante interrupção de conexão e a retirada do aviso após o restabelecimento da rede.
  - **Validações pendentes:**
    - O estado de resposta incerta durante a criação no navegador (interrupção física durante a chamada RPC `create_church_member` com retenção do comando pendente no `sessionStorage` e acionamento da reconciliação de recibo) ainda não foi exercitado no navegador real.
    - Comprovação operacional de cancelamento por timeout de 5 segundos via API HTTP sob transações lentas.
    - Concorrência massiva real entre múltiplas conexões simultâneas disputando o bloqueio consultivo transacional `pg_advisory_xact_lock`.

---

## 5. Incremento de Ciclo de Vida de Membros (Issue #18)

> [!IMPORTANT]
> **Estado conferido em 17/10/2026:** implementação 013/015/016 com provas SQL reversíveis e concorrentes aprovadas em bases descartáveis locais. O lote integrado aprovou 42 disputas com espera real e vinte recusas de isolamento; membro, acesso, tentativas, auditoria e recibo foram conferidos. Fonte e gatilhos preservados, descarte concluído.
> O instalador 013 canônico permanece intacto; 016 substitui as funções necessárias sem conceder acesso direto às tabelas privadas. A instalação permanente foi aprovada e verificada somente no laboratório HTTP existente, após ensaio com ROLLBACK e COMMIT atômico. As tabelas operacionais estavam vazias no checkpoint de instalação e receberam depois somente os dados fictícios identificados da prova.
>
> O lote autorizado de aplicação de 17/10/2026 aprovou A01–A14 no laboratório existente: Auth nativo, convites manuais, exclusão/restauração sem retorno de acesso, paginação, troca de igreja/conta, recuperação por comando/recibo original e recusa 42501 após perda de autoridade. A integração delimitada E20/E21 foi complementada por P0022/P0023 reais, transferência explícita de liderança, encerramento pela liturgia designada e histórico preservado. Não representa entrega da jornada de cultos. A12 usa contraprovas controladas de transporte; retenção e recarga complementam a queda de conexão que provocou reenvio automático idempotente.
>
> A primeira tentativa permanece reprovada por isolamento de sessão: três linhas anteriores de Auth foram alteradas e três registros Auth adicionais foram criados por renovação automática de sessão antiga; registros anteriores de aplicação preservados. A causa foi corrigida somente na cópia do laboratório, com chave SDK própria. A retomada e o encerramento preservaram o baseline posterior de 214 registros, 42 funções, duas proteções e 86 entradas de segurança; isso não apaga a falha do baseline original de 211 registros. Interfaces/ponte encerradas e Auth novamente parado. Dados fictícios e histórico da prova foram retidos. Piloto e porta 3000 não foram alterados; revisão/integração final e encerramento de #12/#18 continuam pendentes. Ver [estado atual](ESTADO-ATUAL.md) e [roteiro 016](sql/016_rehearsal_guide.md).

### 5.1 Endpoints do Ciclo de Vida (Especificação 013/014)

1. **Listagem Administrativa com Filtros:** `public.list_church_members_admin(p_church_id uuid, p_status_filter text, p_limit integer, p_offset integer)`
   - **Filtros suportados:** `'active'`, `'inactive'` e `'all'` (padrão `'active'`).
   - **Retorno:** Tabela contendo `items jsonb` e `total_count bigint`. Cada item inclui `member_id`, `display_name`, `status`, `updated_at` (string ISO opaca UTC com microsegundos), `has_active_access`, `has_church_access` e `has_revoked_access`.
   - **Autorização:** Estritamente restrita a administradores ativos e confirmados da igreja via `church_access` (`42501`).

2. **Restauração Elegível de Membro Inativo:** `public.restore_church_member(p_church_id uuid, p_command_id uuid, p_member_id uuid, p_expected_updated_at text)`
   - **Objetivo:** Restaurar cadastro inativo de membro no rol da igreja sem conceder ou alterar acessos.
   - **Controle de concorrência:** Validação de concorrência otimista via string opaca `p_expected_updated_at` contra `updated_at` da tabela `app_private.members` (gatilho monotônico). Rejeita com `P0019` se houver divergência.
   - **Guarda de acesso legado:** Se o membro possuir vínculo com `status = 'active'` em `church_access`, recusa a restauração com código `P0018`.
   - **Invariância de vínculo revogado:** Se o membro possuir vínculo com `status = 'revoked'` em `church_access`, esse registro permanece **estritamente inalterado** como `'revoked'`. Nenhum login, convite ou permissão de acesso é concedido. O payload do recibo retorna `has_revoked_access = true`.
   - **Atomicidade e Auditoria:** Atualização de `members` (`status = 'active'`), auditoria em `app_private.audit_entries` (schema 003: `church_id`, `action = 'restore_member'`, `actor_user_id`, `actor_source = 'application'`, `details`, `occurred_at`) e gravação do recibo em `app_private.command_receipts` ocorrem rigorosamente na mesma transação atômica. Falha em auditoria desfaz toda a operação (`ROLLBACK`).
   - **Idempotência e Replay Seguro:** Reexecução com a mesma chave e mesmos parâmetros devolve o recibo prévio com o payload da restauração original sem duplicar auditoria ou alterar dados.

3. **Consulta de Recibo de Ciclo de Vida:** `public.get_member_lifecycle_receipt(p_command_id uuid)`
   - Retorna o recibo registrado em `app_private.command_receipts` para a reconciliação segura após respostas incertas.

4. **Exclusão Lógica e Verificação de Dependências:** `public.deactivate_church_member(p_church_id uuid, p_command_id uuid, p_member_id uuid, p_expected_updated_at text)`
   - No instalador 013, a operação continua protegida por P0021. Em ambientes com 015/016 integrados, revalida autorização atual, contexto, autoexclusão, revisão, continuidade administrativa e dependências reais antes da transação efetiva. Liderança ativa exige transferência prévia; participações/responsabilidades em evento aberto bloqueiam; histórico encerrado não é apagado. Ausência da fonte mantém P0021.
   - A transação inativa o membro, revoga somente o vínculo ativo desta igreja, invalida convite aberto válido, finaliza pending válida como cancelled e expirada como expired, e grava auditorias/recibo. Preserva Auth, outra igreja, UUIDs, tentativas consumidas/fechadas e revogação anterior. Restaurar nunca reabre acesso, tentativas ou liderança.

### 5.2 Implementação no Cliente Web e Resposta Incerta

- **Retenção Prévia Obrigatória:** Comandos de restauração e exclusão gravam previamente sua intenção com identidade única (`commandId`), igreja, membro, ação e a revisão original opaca `expectedUpdatedAt` em `window.sessionStorage` antes do envio de rede. Falha de persistência interrompe o fluxo antes da RPC.
- **Tolerância a Falhas de Storage:** Falhas de leitura (`getItem`) ou exceções de análise sintática JSON no storage **não apagam a chave** pendente. Conteúdo corrompido bloqueia novos envios sem ser sobrescrito.
- **Proteção contra Sobrescrita e Alteração de Parâmetros:** Comandos com `commandId` diferente são bloqueados caso já exista pendência no mesmo escopo. Alterações de parâmetros para o mesmo `commandId` são recusadas; reenvios idênticos são preservados.
- **Remoção Segura por CommandId:** A remoção de pendências compara estritamente o `commandId` esperado antes de apagar a chave, impedindo que respostas atrasadas apaguem comandos novos.
- **Recuperação em F5 e Inicialização:** A função `loadAnyPendingMemberCommand` recupera comandos pendentes retidos (criação ou ciclo de vida) e monta o banner de resposta incerta FORA de qualquer modal.
- **Reconciliação e Reexecução:** A tela oferece botões dedicados de "Verificar confirmação" (via `get_member_lifecycle_receipt`) e "Reexecutar restauração" (usando a mesma chave, membro, igreja e a revisão original opaca `expectedUpdatedAt`).
- **Aviso Exato sobre Vínculo Revogado:** No modal de restauração de membro com histórico de acesso revogado, a aplicação exibe rigorosamente:
  > *"A restauração reativa apenas o cadastro do membro nesta igreja. O acesso a esta igreja permanece revogado. A recuperação desse acesso depende de um fluxo separado, ainda não disponível nesta etapa."*
  Sem promessa de novos convites e sem alegações sobre revogação de login global.
- **Confirmação de exclusão:** O modal informa que o cadastro ficará inativo, o acesso apenas à igreja será revogado, histórico/conta serão preservados e restauração não devolverá acesso ou liderança. O servidor decide se as dependências permitem concluir. Se o ambiente ainda responder P0021, o cliente apresenta a indisponibilidade sem confirmar a exclusão.
- **Reposicionamento de Paginação:** Caso uma página superior retorne vazia com total de membros igual a zero, a paginação reposiciona automaticamente para a página 1.
- **Proteção de Contexto Vivo Pós-Await:** Todas as operações assíncronas avaliam a identidade, igreja e geração vigentes por ref/getter após await, protegendo UI, refresh, catch/finally e storage contra alterações em contexto desatualizado.

### 5.3 Testes Automatizados Locais de Cliente

> **Referências históricas do recorte 013:** os guias, scripts, executor e matriz citados abaixo preservam o planejamento e os resultados daquele recorte. A matriz antiga e o roteiro 013 não são o estado vigente do fechamento conjunto e não autorizam reinstalar SQL/fixtures no laboratório já instalado nem separar E20/E21 da #18. Para o aceite posterior SQL/HTTP/interface e seus limites, consultar o [guia 016](sql/016_rehearsal_guide.md) e o [estado atual](ESTADO-ATUAL.md).

- Suíte `test/member-lifecycle-cycle.test.js` cobrindo classificação de erros, isolamento de comandos, ciclo de despacho, reconciliação estrita, validação de retornos por operação, tolerância a falhas no storage, integridade pós-await com troca de igreja e testes reais de componente de `MembersPage` com `react-test-renderer`.
- Planejamento e scripts de concorrência real com duas sessões detalhados em `docs/sql/013_concurrency_rehearsal_guide.md`, `docs/sql/concurrency/013_concurrency_session_a.sql` e `docs/sql/concurrency/013_concurrency_session_b.sql`.
- Guia normativo de instalação, verificação 014 e reversão exata: `docs/sql/013_installation_and_rollback_guide.md`.
- Executor e validador automatizado: `tools/rehearsal-runner-013.js`.
- Roteiro de ensaio em navegador real com backend local: `docs/ROTEIRO-NAVEGADOR-LOCAL-013.md`.
- Matriz de evidências, pendências e critérios de aceite dos seis pontos da issue #18: `docs/FECHAMENTO-ISSUE18-MATRIZ.md`.
