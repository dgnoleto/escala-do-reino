# Escala do Reino — schema inicial de igreja e acesso

Versão 6 · 3 de outubro de 2026

**Situação:** especificação física com [SQL inicial](sql/001_initial_access_structure.sql) ensaiado no projeto Supabase com `ROLLBACK`. A criação permanente e a consulta posterior foram executadas pelo responsável; as capturas de 02/10/2026 confirmam a estrutura e os privilégios verificados. Complementa o [PRD](PRD.md) e a [arquitetura](ARQUITETURA-BANCO.md). Este primeiro incremento cobre igreja, membro, vínculo e convite; equipes, planejamento e execução serão detalhados nos incrementos seguintes. O SQL já aplicado no piloto não deve ser alterado; os novos contratos e restrições aprovados serão introduzidos em incrementos próprios.

## 1. Regras confirmadas e limites

- Login por Google ou e-mail e senha. Contas, senhas e identidades ficam no Supabase Auth. Apple e Microsoft foram descartados pelo responsável nesta etapa em razão dos custos de configuração avaliados, sem compromisso de implementação futura.
- Sem CPF e sem credenciais nas tabelas da aplicação. Recuperação de senha por e-mail via Supabase; admin pode solicitar o envio, mas não define a nova senha nem recebe seu link.
- **Criação de nova igreja ("Criar minha igreja"):** conta autenticada, com e-mail confirmado e sem administração ativa em outra igreja, pode criar uma nova igreja. Operação atômica no servidor cria a igreja, o cadastro de membro do criador, o vínculo de admin (`is_admin = true`, `status = 'active'`) e a auditoria. Não concede acesso a igrejas existentes nem possui campo público de autoconcessão. O procedimento histórico de inicialização privada de manutenção do piloto (Ministério Shalom) fica preservado como registro histórico e expressamente diferenciado deste novo fluxo de produto.
- **Administração em no máximo uma igreja por conta Auth:** uma conta pode ter administração ativa em no máximo uma igreja por vez. Essa regra deve ser garantida no servidor e no banco de dados sob concorrência (ex.: proposta de índice parcial único para `user_id` onde `is_admin = true and status = 'active'`). Ao deixar formalmente uma administração, a conta pode assumir outra. Não há criação de papel de "proprietário"; uma igreja pode ter múltiplos administradores simultâneos.
- **Continuidade administrativa (proteção do último administrador):** o último administrador ativo de uma igreja não pode deixar a administração ou ter seu acesso revogado/desativado sem que outro administrador elegível assuma previamente. O sucessor também precisa respeitar o limite de 1 igreja administrada. Essa proteção deve ser imposta no servidor e no banco.
- **Reutilização da conta Auth e seleção de contexto:** a mesma conta pode ter vínculos autorizados com igrejas distintas (ex.: admin na igreja A e membro básico na igreja B por convite). Uma conta com múltiplos vínculos escolhe explicitamente a igreja consultada; consultas e comandos atuam no contexto selecionado, e a troca de igreja invalida dados em cache e impede mistura entre contextos.
- **Cadastro de membros e convites:** o cadastro básico de membro coleta apenas o nome (`display_name`), sem CPF. Não há campo de e-mail no formulário atual de cadastro. O e-mail do destinatário será informado no fluxo de emissão do convite pelo admin. Cadastros de membros sem conta de login continuam permitidos.
- **Aviso sobre implementação:** criação de igreja ("Criar minha igreja"), administração única por conta e proteção do último administrador foram implementadas no banco pelo incremento 009 e integradas na interface pelo PR #7 na branch `main`. A seleção explícita de contexto também já foi introduzida na web (`SelectChurchPage`). Os fluxos de convites com e-mail, resgate transacional, aprovação de nome e exclusão lógica aguardam implementação em seus respectivos incrementos; a pendência não se limita à interface.
- Convite associado a membro existente, válido por 72 horas desde a emissão, de uso único e cancelável pelo admin.
- Exigir o mesmo e-mail confirmado do destinatário do convite; outro endereço exige cancelamento e nova emissão pelo admin. Encontrar um e-mail na base, isoladamente, não concede acesso.
- No primeiro acesso autenticado, confirmar o nome cadastrado ou propor outro. Nome diferente aguarda aprovação de admin antes de atualizar o membro existente e liberar acesso; não cria outro membro.
- Manter um convite pendente por membro; nova emissão cancela o anterior.
- Nome proposto e aprovação do admin precisam ocorrer antes do vencimento original de 72 horas. Sem aprovação a tempo, a solicitação expira sem acesso; precisa de novo convite.
- Login não libera dados da igreja. O acesso depende de vínculo autorizado e ativo.
- Um vínculo por conta/igreja e por membro/igreja.
- **Exclusão lógica recuperável:** remoções de cadastros pela aplicação devem ser lógicas e recuperáveis, preservando identificadores, histórico e referências operacionais. Recuperação exige autorização administrativa e auditoria. Restaurar um membro não restaura automaticamente seus acessos revogados. A remoção não contorna a proteção do último administrador. Avaliar relação com `active`/`inactive` antes de definir novos campos como `deleted_at`. A limpeza de fixtures dos ensaios SQL permanece intocada.
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
| `default_duration_policy` | `text` | `warn` ou `block`; obrigatório e sem valor padrão no SQL; escolha explícita ao cadastrar a igreja; o responsável confirmou `warn` para o piloto em 02/10/2026. Não alterar o SQL já aplicado para inserir um padrão silencioso. |
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

**Restrição de administração única e proteção de continuidade:**
- Cada `user_id` só pode ter no máximo uma linha em `church_access` com `is_admin = true` e `status = 'active'` em todo o banco (garantido no servidor e no banco sob concorrência, por exemplo via índice parcial único em `user_id` filtrado por `is_admin = true and status = 'active'`).
- Proteção do último administrador: nenhuma operação da aplicação pode revogar, desativar ou remover o último administrador ativo de uma igreja sem que outro administrador elegível assuma previamente. O sucessor também precisa respeitar o limite de 1 igreja administrada.
- Não oferecer cadastro público de admin. Um convite resgatado concede acesso básico de membro, sem liderança ou admin automaticamente.

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

Unicidade do token não garante uso único sozinha. Resgate e criação/reativação do vínculo precisam de transação e bloqueio da linha do convite; duas tentativas concorrentes não concedem dois acessos. A quantidade já está decidida: um convite pendente por membro, e nova emissão cancela o anterior. Bloquear o membro durante emissão/resgate evita corrida entre convites distintos. O [segundo incremento](SCHEMA-APROVACAO-AUDITORIA.md) já acrescentou o índice de um convite aberto por membro, a solicitação de nome pendente e a estrutura de auditoria. Isso não implementa os comandos transacionais de emissão, resgate ou aprovação.

## 4. Restrições e índices propostos

- Chaves estrangeiras conferem igreja e membro juntos; nunca aceitar referência a membro de outra igreja.
- Referências a contas e registros operacionais não apagam dados em cascata. Desativação e remoção de conta precisam de procedimento definido.
- Índices para membros por igreja/situação e convites por igreja/membro, destinatário e vencimento, conforme consultas autorizadas. Não duplicar índices já criados pelas restrições únicas.
- Eventos, equipes e funções terão suas próprias tabelas depois; não acrescentar cursos, finanças, CPF ou preferências individuais de fuso.
- Histórico mínimo da emissão, resgate, revogação e inicialização do admin precisa acompanhar os comandos antes de utilizá-los. A estrutura física de `audit_entries` já foi acrescentada no segundo incremento; sua gravação funcional ainda precisa acompanhar esses contratos. Não liberar alterações sem registro.

## 5. Pontos a fechar antes da migração utilizável

1. Validar no servidor o mesmo e-mail confirmado do destinatário; e-mail divergente exige cancelamento/reemissão. O e-mail é informado na emissão do convite, e o cadastro básico de membro continua com apenas o nome. Reutilização da mesma conta Auth para vínculos em igrejas distintas e seleção explícita de contexto estão decididas e integradas na web (`SelectChurchPage`); pendente validação integrada com novos convites.
2. Nome diferente exige proposta separada e aprovação de admin antes de liberar acesso. O prazo de análise já está decidido: respeitar as 72 horas originais, sem prorrogação. Decisão confirmada: rejeição encerra a tentativa, exigindo novo convite para nova entrada. Reemissão cancela a solicitação antiga de outro nome que ainda estiver pendente, preservando histórico.
3. Associação e recuperação entre provedores; CPF, nome igual ou admin isoladamente não comprovam controle das credenciais (permanece decisão separada).
4. Um convite pendente por membro e cancelamento do anterior na reemissão estão confirmados. Decisão confirmada: ao reemitir durante análise, cancelar a solicitação antiga (`access_requests`), preservar o convite consumido (sem revogá-lo) e emitir novo convite; o administrador copia e compartilha o link manualmente no primeiro incremento. Revogação de acesso, retirada pelo solicitante e reativação permanecem como decisões e fluxos separados.
5. Exclusão lógica: decidida como lógica e recuperável, preservando integridade, referências, histórico e proteção do último administrador; pendente avaliação da relação entre `active`/`inactive` e representação física no banco antes de novos campos como `deleted_at`. Limpeza de fixtures SQL inalterada.
6. Criação de nova igreja ("Criar minha igreja"): criação atômica, limite de 1 igreja administrada por conta Auth e proteção de continuidade do último admin foram implementadas no servidor/banco (scripts 009/010) e integradas na web pelo PR #7 na `main`. O procedimento histórico de bootstrap do piloto permanece como registro histórico separado. Política padrão confirmada: `warn` (avisar e permitir publicar). Pendente no piloto: validação de criação positiva de igreja real com dados reais do piloto.

Essas pendências permitem revisar campos e relações agora, mas não autorizam implementar fluxos ambíguos nem liberar acesso. Na implantação, habilitar/configurar Google e Email, mantendo confirmação de e-mail; Apple, Azure/Microsoft e métodos não aprovados ficam desabilitados. SMTP para membros e testes de confirmação/recuperação são pré-requisitos do piloto. Isso é configuração do Auth, não uma garantia fornecida por estas tabelas.

## 6. Validação prevista

Antes de aplicar ao projeto real, validar em ambiente de teste: UTF-8; relações entre igrejas; unicidades de vínculo; conta sem convite; convite aos 71h59 e no vencimento; resgate/cancelamento concorrentes; nome confirmado; revogação; acesso direto às tabelas; admin sem operação sobre credenciais.

O [SQL de estrutura](sql/001_initial_access_structure.sql) cria apenas quatro tabelas vazias, índices, restrições e gatilhos internos de fuso e atualização de datas. Executa em transação, exige UTF-8 e para se `app_private` já existir. Revoga acesso direto de `PUBLIC`, `anon`, `authenticated` e `service_role`; mantém RLS sem políticas de liberação. Não altera o Auth nem cria dados, admin, emissão/resgate ou auditoria. Não entra em `supabase/migrations` e não é implantado pela integração GitHub.

Antes de executar a estrutura, conferir o ambiente com a [consulta somente leitura](sql/000_preflight.sql). A revisão de texto/estrutura não substitui execução em PostgreSQL. O ensaio foi executado pelo responsável no projeto Supabase e a captura mostrou conclusão com `ROLLBACK`; não houve execução local pelo agente. A cobertura é a das verificações do ensaio, sem substituir testes dos fluxos. A captura posterior da Data API confirma `app_private` desmarcado; a desativação de exposição automática de novas tabelas foi informada pelo responsável. Mesmo após criar tabelas, não usar comandos de produto até implementar e testar a autorização, o resgate transacional e a auditoria.

**Pré-verificação confirmada pela captura de 02/10/2026:** `server_encoding = UTF8`, `client_encoding = UTF8`, `app_private_available = true` e `supabase_auth_present = true`. Isso confirma apenas os pré-requisitos, não a criação ou o funcionamento das tabelas.

**Ensaio transacional executado pelo responsável em 02/10/2026:** a captura mostra `PASS: ensaio concluído; nenhuma tabela persistida` após executar o [arquivo completo](sql/001_validate_initial_structure.sql). Ele reproduz a estrutura, verifica privilégios efetivos, RLS, funções internas, preservação de acentos/apóstrofos, validação de fuso/nome/política e atualização de datas, e termina com `ROLLBACK`. Não cria usuários nem deixa dados/tabelas persistidos em uma execução bem-sucedida. A mensagem final esperada é `PASS: ensaio concluído; nenhuma tabela persistida`. A captura confirma o resultado final do ensaio; relações, vínculos, convites e comandos precisam de testes funcionais específicos depois. Manter sua cópia de DDL sincronizada com o script de criação definitivo.

**Criação permanente e verificação confirmadas pelas capturas de 02/10/2026:** o [script de criação](sql/001_initial_access_structure.sql) terminou com `Success. No rows returned`. A [consulta posterior](sql/002_verify_initial_structure.sql) mostrou `access_invitations`, `church_access`, `churches` e `members`, todas com `rls_enabled = true`; `anon_has_privileges`, `authenticated_has_privileges` e `service_role_has_privileges` vieram `false` nas quatro linhas. Isso confirma a existência e os privilégios consultados, não o funcionamento dos fluxos da aplicação. Não repetir o script de criação nesse projeto.

**Data API conferida em 02/10/2026:** a captura mostra `public` e `graphql_public` selecionados e `app_private` desmarcado. O responsável informou ter desligado `Automatically expose new tables`; a configuração final desse interruptor não foi reinspecionada. Os privilégios das tabelas existentes já haviam sido conferidos por SQL.

**Segundo incremento em 02/10/2026:** `access_requests` e `audit_entries`, índice de um convite aberto por membro e FK composta acrescentados pelo responsável; evidências e limites no [schema de aprovação e auditoria](SCHEMA-APROVACAO-AUDITORIA.md). Há seis tabelas internas. Não repetir os scripts de criação já aplicados.

**Próximo passo:** preparar os dados reais da igreja e a inicialização controlada, concluir contratos e implementar comandos conforme o [fluxo de acesso](ACESSO-E-AUDITORIA.md). Destinatário, nome proposto, reemissão e prazo de aprovação estão confirmados. Aprovação expirada não pode ativar vínculo nem alterar nome. Concessão do primeiro admin, autorização de comandos, vínculo/resgate, testes funcionais e integração com a web permanecem pendentes.

Referências técnicas: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [dados de usuários](https://supabase.com/docs/guides/auth/managing-user-data), [configuração do Auth](https://supabase.com/docs/guides/auth/general-configuration) e [login social](https://supabase.com/docs/guides/auth/social-login).
