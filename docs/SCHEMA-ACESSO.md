# Escala do Reino — schema inicial de igreja e acesso

Versão 1 · 2 de outubro de 2026

**Situação:** especificação física para revisão, sem migração SQL criada ou executada. Complementa o [PRD](PRD.md) e a [arquitetura](ARQUITETURA-BANCO.md). Este primeiro incremento cobre igreja, membro, vínculo e convite; equipes, planejamento e execução serão detalhados nos incrementos seguintes.

## 1. Regras confirmadas e limites

- Login por Google, Apple ou Microsoft. Contas e identidades ficam no Supabase Auth.
- Sem CPF, senha própria, formulário de recuperação de senha própria ou alteração de credenciais pelo admin da igreja.
- Convite associado a membro existente, válido por 72 horas desde a emissão, de uso único e cancelável pelo admin.
- No primeiro acesso autenticado, confirmar/preencher o nome sem criar outro membro. Divergência com o cadastro existente exige procedimento a detalhar.
- Login não libera dados da igreja. O acesso depende de vínculo autorizado e ativo.
- Um vínculo por conta/igreja e por membro/igreja. Uma conta pode ter vínculos autorizados com igrejas distintas.
- Fuso da igreja, sem preferência individual. Nomes técnicos em inglês e texto em UTF-8.

A validade de 72 horas é do convite da aplicação, não um ajuste automático de validade dos tokens OAuth do provedor.

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
| `default_duration_policy` | `text` | `warn` ou `block`; padrão inicial continua pendente, sem escolher silenciosamente. |
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
| `created_by_user_id` | `uuid` | Referência à conta autora em `auth.users`; procedimento inicial controlado. |
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
| `granted_by_user_id` | `uuid` | Conta responsável pela concessão; primeiro admin exige inicialização controlada e auditada. |
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

O estado pode ser derivado: resgatado, cancelado, expirado ou pendente. Expiração depende do horário atual do servidor e não exige tarefa agendada para atualizar uma coluna. Resgate e cancelamento são terminais e mutuamente exclusivos; autoria e instante de cada operação devem existir juntos. Não aceitar resgate no instante do vencimento ou depois.

Unicidade do token não garante uso único sozinha. Resgate e criação/reativação do vínculo precisam de transação e bloqueio da linha do convite; duas tentativas concorrentes não concedem dois acessos. Quantidade de convites simultâneos e tratamento de reemissão devem ser fechados antes de implementar a emissão.

## 4. Restrições e índices propostos

- Chaves estrangeiras conferem igreja e membro juntos; nunca aceitar referência a membro de outra igreja.
- Referências a contas e registros operacionais não apagam dados em cascata. Desativação e remoção de conta precisam de procedimento definido.
- Índices para membros por igreja/situação e convites por igreja/membro, destinatário e vencimento, conforme consultas autorizadas. Não duplicar índices já criados pelas restrições únicas.
- Eventos, equipes e funções terão suas próprias tabelas depois; não acrescentar cursos, finanças, CPF ou preferências individuais de fuso.
- Histórico mínimo da emissão, resgate, revogação e inicialização do admin precisa acompanhar os comandos antes de utilizá-los. A estrutura física de `audit_entries` será detalhada com esses contratos; não liberar alterações sem registro.

## 5. Pontos a fechar antes da migração utilizável

1. Comprovação do destinatário quando o e-mail do provedor difere do convite, inclusive endereço privado Apple.
2. Confirmação do nome e tratamento de divergências sem sobrescrever o cadastro silenciosamente.
3. Associação e recuperação entre provedores; CPF, nome igual ou admin isoladamente não comprovam controle das credenciais.
4. Revogação, reemissão, reativação e número de convites pendentes por membro.
5. Desativação de cadastros utilizados, sem tratar a proposta como decisão já confirmada.
6. Primeiro admin e trilha de auditoria; fuso/local reais do piloto e política padrão de duração.

Essas pendências permitem revisar campos e relações agora, mas não autorizam implementar fluxos ambíguos nem liberar acesso. Na implantação, habilitar/configurar os três provedores e desabilitar métodos de autenticação próprios não aprovados. Isso é configuração do Auth, não uma garantia fornecida por estas tabelas.

## 6. Validação prevista

Antes de aplicar ao projeto real, validar em ambiente de teste: UTF-8; relações entre igrejas; unicidades de vínculo; conta sem convite; convite aos 71h59 e no vencimento; resgate/cancelamento concorrentes; nome confirmado; revogação; acesso direto às tabelas; admin sem operação sobre credenciais.

Este arquivo é especificação. Não houve execução de SQL nem teste de integração com o Supabase nesta revisão.

Referências técnicas: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [dados de usuários](https://supabase.com/docs/guides/auth/managing-user-data), [configuração do Auth](https://supabase.com/docs/guides/auth/general-configuration) e [login social](https://supabase.com/docs/guides/auth/social-login).
