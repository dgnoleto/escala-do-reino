# Escala do Reino — schema inicial de igreja e acesso

Versão 4 · 2 de outubro de 2026

**Situação:** especificação física com [SQL inicial](sql/001_initial_access_structure.sql) ensaiado no projeto Supabase com `ROLLBACK`. A criação permanente e a consulta posterior foram executadas pelo responsável; as capturas de 02/10/2026 confirmam a estrutura e os privilégios verificados. Complementa o [PRD](PRD.md) e a [arquitetura](ARQUITETURA-BANCO.md). Este primeiro incremento cobre igreja, membro, vínculo e convite; equipes, planejamento e execução serão detalhados nos incrementos seguintes.

## 1. Regras confirmadas e limites

- Login por Google ou e-mail e senha. Contas, senhas e identidades ficam no Supabase Auth. Apple e Microsoft ficam para evolução posterior.
- Sem CPF e sem credenciais nas tabelas da aplicação. Recuperação de senha por e-mail via Supabase; admin pode solicitar o envio, mas não define a nova senha nem recebe seu link.
- Convite associado a membro existente, válido por 72 horas desde a emissão, de uso único e cancelável pelo admin.
- Exigir o mesmo e-mail confirmado do destinatário do convite; outro endereço exige cancelamento e nova emissão pelo admin.
- No primeiro acesso autenticado, confirmar o nome cadastrado ou propor outro. Nome diferente aguarda aprovação de admin antes de atualizar o membro existente e liberar acesso; não cria outro membro.
- Manter um convite pendente por membro; nova emissão cancela o anterior.
- Nome proposto e aprovação do admin precisam ocorrer antes do vencimento original de 72 horas. Sem aprovação a tempo, a solicitação expira sem acesso; precisa de novo convite.
- Login não libera dados da igreja. O acesso depende de vínculo autorizado e ativo.
- Um vínculo por conta/igreja e por membro/igreja. Uma conta pode ter vínculos autorizados com igrejas distintas.
- Fuso da igreja, sem preferência individual. Nomes técnicos em inglês e texto em UTF-8.

A validade de 72 horas é do convite da aplicação, não um ajuste automático de validade dos tokens OAuth ou dos códigos/links do Supabase Auth (configurados com uma hora nesta etapa).

## 2. Esquema e convenções

Propõe-se o esquema interno `app_private`, fora dos esquemas expostos pela Data API. UUIDs identificam registros; instantes usam `timestamptz`. As quatro tabelas internas começam com RLS habilitada e sem acesso direto para clientes. As consultas e comandos serão liberados por contratos específicos após definir a autorização; a interface não ganha permissão irrestrita de atualização.

Não criar uma cópia de `auth.users` nem guardar senhas ou tokens dos provedores nessas tabelas. Referenciar apenas a chave primária de usuário mantida pelo Supabase. As permissões da aplicação não derivam de metadados editáveis pelo cliente.

Campos de autoria e datas de registro são preenchidos pelo servidor. Os valores padrão e comprimentos abaixo são propostas de implementação, não novos requisitos de produto.

## 3. Tabelas

### 3.1 `app_private.churches`

| Campo | Tipo | Restrição ou finalidade |
| --- | --- | --- |
| `id` | `uuid` | Chave primária; gerado no servidor. |
| `name` | `text` | Obrigatório; propor 1–160 caracteres após retirar espaços nas extremidades. |
| `timezone` | `text` | Obrigatório; validar identificador reconhecido pela base de fusos do PostgreSQL. Não inferir o fuso do piloto. |
| `address` | `text` | Localização informada; propor até 500 caracteres. |
| `google_maps_url` | `text` | Link de localização; validar formato e origem permitida no servidor antes de apresentá-lo. |
| `default_duration_policy` | `text` | `warn` ou `block`; obrigatório e sem valor padrão no SQL; escolha explícita ao cadastrar a igreja, pois o padrão de produto continua pendente. |
| `status` | `text` | `active` ou `inactive`; procedimento de desativação ainda pendente. |
| `created_at` | `timestamptz` | Obrigatório; momento do registro. |
| `updated_at` | `timestamptz` | Obrigatório; atualizado pelo servidor. |

Nome não é identificador único. Alterar o fuso não remarca eventos já gravados.

### 3.2 `app_private.members`

| Campo | Tipo | Restrição ou finalidade |
| --- | --- | --- |
| `id` | `uuid` | Chave primária. |
| `church_id` | `uuid` | Obrigatório; referência à igreja, sem exclusão em cascata proposta. |
| `display_name` | `text` | Obrigatório; propor 1–120 caracteres após retirar espaços nas extremidades. Preservar acentos e apóstrofos. |
| `status` | `text` | `active` ou `inactive`; tratamento de escalas futuras depende da decisão de desativação. |
| `created_by_user_id` | `uuid` | Obrigatório; referência à conta autora em `auth.users`; procedimento inicial controlado. |
| `created_at` | `timestamptz` | Obrigatório; momento do registro. |
| `updated_at` | `timestamptz` | Obrigatório; atualizado pelo servidor. |

Unicidade adicional em `(church_id, id)` suporta referências que conferem a igreja. Não tornar nome único. Um membro pode existir sem conta ou login. Contatos adicionais só entram quando o fluxo demonstrar necessidade; o destinatário do convite fica na tabela própria.

### 3.3 `app_private.church_access`

| Campo | Tipo | Restrição ou finalidade |
| --- | --- | --- |
| `id` | `uuid` | Chave primária. |
| `church_id` | `uuid` | Obrigatório; referência à igreja. |
| `user_id` | `uuid` | Obrigatório; referência a `auth.users(id)`. |
| `member_id` | `uuid` | Obrigatório; referência composta a `members(church_id, id)`. |
| `status` | `text` | `active` ou `revoked`. |
| `is_admin` | `boolean` | Obrigatório; padrão falso. Somente operação autorizada pode conceder. |
| `onboarding_completed_at` | `timestamptz` | Obrigatório para acesso ativo; registra conclusão da etapa inicial do nome. |
| `granted_by_user_id` | `uuid` | Obrigatório; conta responsável pela concessão; primeiro admin exige inicialização controlada e auditada. |
| `granted_at` | `timestamptz` | Obrigatório; momento da concessão. |
| `revoked_by_user_id` | `uuid` | Conta responsável pela revogação, quando ocorrer. |
| `revoked_at` | `timestamptz` | Momento da revogação; obrigatório no estado revogado. |
| `created_at` | `timestamptz` | Obrigatório. |
| `updated_at` | `timestamptz` | Obrigatório. |

Unicidade em `(church_id, user_id)` e `(church_id, member_id)`, inclusive para vínculos revogados. Recuperação/reativação deve operar o vínculo existente, preservando histórico; não apagar a linha para contornar a unicidade. O fluxo final de recuperação permanece pendente.

Não oferecer cadastro público de admin. Um convite resgatado concede acesso básico, sem liderança ou admin automaticamente.

### 3.4 `app_private.access_invitations`

| Campo | Tipo | Restrição ou finalidade |
| --- | --- | --- |
| `id` | `uuid` | Chave primária. |
| `church_id` | `uuid` | Obrigatório; referência à igreja. |
| `member_id` | `uuid` | Obrigatório; referência composta a `members(church_id, id)`. |
| `recipient_email` | `text` | Destinatário informado pelo admin; validação/normalização pelo servidor. |
| `token_digest` | `bytea` | Obrigatório e único; resumo SHA-256 de token aleatório de alta entropia. Propor tamanho de 32 bytes. Token completo não é persistido. |
| `issued_by_user_id` | `uuid` | Obrigatório; conta emissora, com admin ativo na igreja validado no momento da emissão. |
| `issued_at` | `timestamptz` | Obrigatório; definido pelo servidor. |
| `expires_at` | `timestamptz` | Obrigatório; exatamente 72 horas após `issued_at`. |
| `redeemed_by_user_id` | `uuid` | Conta que resgatou o convite, quando ocorrer. |
| `redeemed_at` | `timestamptz` | Momento do resgate. |
| `revoked_by_user_id` | `uuid` | Conta que cancelou o convite, quando ocorrer. |
| `revoked_at` | `timestamptz` | Momento do cancelamento. |

O estado pode ser derivado: resgatado/consumido, cancelado, expirado ou pendente. Na proposta de fluxo com nome diferente, consumir o convite registra a apresentação válida; a solicitação separada ainda precisa de aprovação dentro do vencimento original antes de liberar acesso. Consumo sozinho não equivale a vínculo ativo. Expiração depende do horário atual do servidor e não exige tarefa agendada para atualizar uma coluna. Resgate e cancelamento são terminais e mutuamente exclusivos; autoria e instante de cada operação devem existir juntos. Não aceitar resgate no instante do vencimento ou depois.

Unicidade do token não garante uso único sozinha. Resgate e criação/reativação do vínculo precisam de transação e bloqueio da linha do convite; duas tentativas concorrentes não concedem dois acessos. A quantidade já está decidida: um convite pendente por membro, e nova emissão cancela o anterior. Bloquear o membro durante emissão/resgate evita corrida entre convites distintos. A restrição física adicional, a solicitação de nome pendente e a auditoria serão acrescentadas em incremento próprio; essas mudanças ainda não foram aplicadas às quatro tabelas existentes.

## 4. Restrições e índices propostos

- Chaves estrangeiras conferem igreja e membro juntos; nunca aceitar referência a membro de outra igreja.
- Referências a contas e registros operacionais não apagam dados em cascata. Desativação e remoção de conta precisam de procedimento definido.
- Índices para membros por igreja/situação e convites por igreja/membro, destinatário e vencimento, conforme consultas autorizadas. Não duplicar índices já criados pelas restrições únicas.
- Eventos, equipes e funções terão suas próprias tabelas depois; não acrescentar cursos, finanças, CPF ou preferências individuais de fuso.
- Histórico mínimo da emissão, resgate, revogação e inicialização do admin precisa acompanhar os comandos antes de utilizá-los. A estrutura física de `audit_entries` será detalhada com esses contratos; não liberar alterações sem registro.

## 5. Pontos a fechar antes da migração utilizável

1. Validar no servidor o mesmo e-mail confirmado do destinatário; e-mail divergente exige cancelamento/reemissão. Associação Google/e-mail-senha da mesma pessoa e provedores futuros ainda exigem desenho seguro.
2. Nome diferente exige proposta separada e aprovação de admin antes de liberar acesso. O prazo de análise já está decidido: respeitar as 72 horas originais, sem prorrogação. Fechar rejeição/cancelamento e comportamento quando o cadastro muda enquanto a solicitação está pendente.
3. Associação e recuperação entre provedores; CPF, nome igual ou admin isoladamente não comprovam controle das credenciais.
4. Um convite pendente por membro e cancelamento do anterior na reemissão estão confirmados. Fechar efeitos sobre solicitações de nome já abertas, revogação de acesso e reativação.
5. Desativação de cadastros utilizados, sem tratar a proposta como decisão já confirmada.
6. Primeiro admin e trilha de auditoria; fuso/local reais do piloto e política padrão de duração.

Essas pendências permitem revisar campos e relações agora, mas não autorizam implementar fluxos ambíguos nem liberar acesso. Na implantação, habilitar/configurar Google e Email, mantendo confirmação de e-mail; Apple, Azure/Microsoft e métodos não aprovados ficam desabilitados. SMTP para membros e testes de confirmação/recuperação são pré-requisitos do piloto. Isso é configuração do Auth, não uma garantia fornecida por estas tabelas.

## 6. Validação prevista

Antes de aplicar ao projeto real, validar em ambiente de teste: UTF-8; relações entre igrejas; unicidades de vínculo; conta sem convite; convite aos 71h59 e no vencimento; resgate/cancelamento concorrentes; nome confirmado; revogação; acesso direto às tabelas; admin sem operação sobre credenciais.

O [SQL de estrutura](sql/001_initial_access_structure.sql) cria apenas quatro tabelas vazias, índices, restrições e gatilhos internos de fuso e atualização de datas. Executa em transação, exige UTF-8 e para se `app_private` já existir. Revoga acesso direto de `PUBLIC`, `anon`, `authenticated` e `service_role`; mantém RLS sem políticas de liberação. Não altera o Auth nem cria dados, admin, emissão/resgate ou auditoria. Não entra em `supabase/migrations` e não é implantado pela integração GitHub.

Antes de executar a estrutura, conferir o ambiente com a [consulta somente leitura](sql/000_preflight.sql). A revisão de texto/estrutura não substitui execução em PostgreSQL. O ensaio foi executado pelo responsável no projeto Supabase e a captura mostrou conclusão com `ROLLBACK`; não houve execução local pelo agente. A cobertura é a das verificações do ensaio, sem substituir testes dos fluxos. A captura posterior da Data API confirma `app_private` desmarcado; a desativação de exposição automática de novas tabelas foi informada pelo responsável. Mesmo após criar tabelas, não usar comandos de produto até implementar e testar a autorização, o resgate transacional e a auditoria.

**Pré-verificação confirmada pela captura de 02/10/2026:** `server_encoding = UTF8`, `client_encoding = UTF8`, `app_private_available = true` e `supabase_auth_present = true`. Isso confirma apenas os pré-requisitos, não a criação ou o funcionamento das tabelas.

**Ensaio transacional executado pelo responsável em 02/10/2026:** a captura mostra `PASS: ensaio concluído; nenhuma tabela persistida` após executar o [arquivo completo](sql/001_validate_initial_structure.sql). Ele reproduz a estrutura, verifica privilégios efetivos, RLS, funções internas, preservação de acentos/apóstrofos, validação de fuso/nome/política e atualização de datas, e termina com `ROLLBACK`. Não cria usuários nem deixa dados/tabelas persistidos em uma execução bem-sucedida. A mensagem final esperada é `PASS: ensaio concluído; nenhuma tabela persistida`. A captura confirma o resultado final do ensaio; relações, vínculos, convites e comandos precisam de testes funcionais específicos depois. Manter sua cópia de DDL sincronizada com o script de criação definitivo.

**Criação permanente e verificação confirmadas pelas capturas de 02/10/2026:** o [script de criação](sql/001_initial_access_structure.sql) terminou com `Success. No rows returned`. A [consulta posterior](sql/002_verify_initial_structure.sql) mostrou `access_invitations`, `church_access`, `churches` e `members`, todas com `rls_enabled = true`; `anon_has_privileges`, `authenticated_has_privileges` e `service_role_has_privileges` vieram `false` nas quatro linhas. Isso confirma a existência e os privilégios consultados, não o funcionamento dos fluxos da aplicação. Não repetir o script de criação nesse projeto.

**Data API conferida em 02/10/2026:** a captura mostra `public` e `graphql_public` selecionados e `app_private` desmarcado. O responsável informou ter desligado `Automatically expose new tables`; a configuração final desse interruptor não foi reinspecionada. Os privilégios das tabelas existentes já haviam sido conferidos por SQL.

**Próximo passo:** detalhar a solicitação de nome pendente e a trilha de auditoria conforme o [fluxo de acesso](ACESSO-E-AUDITORIA.md). Destinatário, nome proposto, reemissão e prazo de aprovação estão confirmados. Aprovação expirada não pode ativar vínculo nem alterar nome. Primeiro admin, autorização de comandos, vínculo/resgate, testes funcionais e integração com a web permanecem pendentes. Nenhuma nova tabela ou função foi aplicada nesta revisão.

Referências técnicas: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [dados de usuários](https://supabase.com/docs/guides/auth/managing-user-data), [configuração do Auth](https://supabase.com/docs/guides/auth/general-configuration) e [login social](https://supabase.com/docs/guides/auth/social-login).
