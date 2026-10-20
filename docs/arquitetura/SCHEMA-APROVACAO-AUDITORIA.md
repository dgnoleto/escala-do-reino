# Escala do Reino — schema de aprovação de nome e auditoria

Versão 3 · 3 de outubro de 2026

**Situação:** segundo incremento aplicado pelo responsável no Supabase em 02/10/2026 (solicitação de nome e auditoria). Em etapa subsequente informada pelo responsável, o script `007_member_management.sql` adicionou `app_private.command_receipts` (totalizando sete tabelas internas em `app_private`) e as três RPCs de membros (totalizando quatro RPCs públicas em `public`). Complementa o [fluxo de acesso](../acesso/ACESSO-E-AUDITORIA.md), o [schema inicial](SCHEMA-ACESSO.md), o [cadastro de membros](../produto/CADASTRO-MEMBROS.md) e as decisões de produto de 03/10/2026 (criação atômica de igreja, administração única por conta, continuidade do último admin, seleção de contexto e exclusão lógica recuperável). Não repetir os scripts de criação no projeto existente.

## 1. Regras e limites

- Mesmo e-mail confirmado do destinatário; Google ou e-mail/senha.
- Um convite pendente por membro; emissão de outro cancela o anterior.
- Nome diferente aguarda aprovação do admin antes de alterar cadastro ou conceder acesso.
- Proposta e aprovação antes do vencimento original de 72 horas; sem prorrogação.
- **Auditoria de criação de igreja e administração:** no piloto (Ministério Shalom), a igreja e o primeiro admin foram inicializados por operador de manutenção (`actor_source = 'maintenance'`). No fluxo aprovado de produto ("Criar minha igreja", implementado no banco pelo incremento 009 e integrado na web pelo PR #7 na `main`), a criação atômica da igreja, membro do criador e vínculo administrativo (`is_admin = true`) registra auditoria com `actor_source = 'application'`.
- **Auditoria de governança e continuidade:** a transferência de administração exige assunção prévia de sucessor elegível (respeitando o limite de 1 igreja administrada por conta Auth); tentativas de desativar ou revogar o último admin ativo são bloqueadas (garantias instaladas no incremento 009).
- **Auditoria de exclusão lógica e recuperação:** remoção lógica de membros e sua restauração exigem registro transacional em `audit_entries`. Restaurar membro não restaura acessos revogados.
- **Aviso sobre implementação:** criação de igreja, limite de 1 administração ativa por conta e continuidade administrativa foram implementadas no banco pelo incremento 009 e integradas na interface pelo PR #7 na `main`. A seleção explícita de contexto também já foi introduzida na web (`SelectChurchPage`). Os fluxos de convites com e-mail, resgate transacional, aprovação de nome e exclusão lógica aguardam implementação em seus respectivos incrementos.

Este incremento criou somente estrutura fechada, índices e restrições. Não implementa emissão/resgate, aprovação, criação de igreja ou endpoints de recuperação. Alterações de nome, acesso e auditoria só serão liberadas por comandos transacionais autorizados.

## 2. Alterações em `access_invitations`

Índice único `(church_id, member_id)` para linhas com `redeemed_at is null and revoked_at is null`. Não depende do relógio; uma linha vencida ainda ocupa a posição e precisa ser finalizada transacionalmente (marcando `revoked_at = clock_timestamp()`) pela transação de reemissão para liberar o índice. O histórico preserva o vencimento original e o motivo da substituição na auditoria.

**Atenção à restrição física `access_invitations_terminal_state`:** o schema proíbe estritamente `redeemed_at is not null and revoked_at is not null`. Ao reemitir um convite durante a análise de um nome proposto (quando o convite anterior já foi consumido e gerou uma linha em `access_requests`), a transação deve cancelar a solicitação (`access_requests.status = 'cancelled'`), mas NÃO pode revogar a linha do convite consumido (mantendo `revoked_at is null`), inserindo em seguida o novo convite.

Unicidade auxiliar em `(church_id, member_id, id, redeemed_by_user_id, expires_at)` permite que a solicitação referencie o convite já consumido pela mesma conta e seu prazo original. Uma FK com `invitation_id` sozinho não comprova igreja/membro/conta. Convite consumido não significa acesso concedido.

Antes de aplicar, conferir duplicidades não finalizadas; se houver, resolver com procedimento de produto antes do índice. O incremento não cancela nem altera convites existentes automaticamente.

## 3. `app_private.access_requests`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | `uuid` | Chave primária. |
| `church_id` | `uuid` | Igreja existente. |
| `member_id` | `uuid` | FK composta com igreja para membro existente. |
| `invitation_id` | `uuid` | Único; uma solicitação por convite consumido. |
| `requester_user_id` | `uuid` | Conta Auth que apresentou o convite; não recebida livremente do cliente. |
| `original_display_name` | `text` | Nome do cadastro no momento da proposta; 1–120 caracteres sem espaços externos. |
| `proposed_display_name` | `text` | Nome proposto, diferente do original; 1–120 caracteres. |
| `submitted_at` | `timestamptz` | Instante da proposta; anterior ao vencimento. |
| `expires_at` | `timestamptz` | Mesmo vencimento original do convite, conferido pela FK composta. |
| `status` | `text` | Estado técnico: `pending`, `approved`, `rejected`, `cancelled` ou `expired`. |
| `decided_by_user_id` | `uuid` | Conta decisora nas decisões humanas; FK para Auth. |
| `decided_at` | `timestamptz` | Momento da decisão/finalização; não anterior à proposta. |
| `created_at`, `updated_at` | `timestamptz` | Datas do servidor; gatilho preenche atualização. |

FK composta inclui igreja, membro, convite, conta solicitante e prazo. Confere que a conta corresponde a `redeemed_by_user_id`; o comando ainda deve validar e-mail, instante real do consumo e autorização.

Pendente não tem decisão registrada. Aprovado/rejeitado/cancelado exige decisor e instante. Expirado persistido exige instante no vencimento ou depois, sem atribuir um decisor humano fictício. Enquanto permanece `pending`, o prazo atual ainda determina a expiração efetiva: não depender de uma tarefa para impedir aprovação vencida.

`approved` exige `decided_at < expires_at`. Essa restrição não substitui a validação do horário atual após bloqueios: um comando privilegiado poderia gravar um instante antigo. Autoria/instantes vêm do servidor; não aceitar datas do formulário como prova de aprovação válida.

Decisões de produto confirmadas para o incremento de convites:
1. Reemissão de convite durante análise cancela a solicitação antiga de outro nome (`status = 'cancelled'`), preservando o histórico da solicitação e o convite consumido original, emitindo um novo convite.
2. Rejeição pelo administrador encerra a tentativa (`status = 'rejected'`); nova entrada exige que o admin emita um novo convite.
3. No primeiro incremento, o administrador copia e compartilha o link do convite manualmente (sem envio automático por e-mail nesta etapa). Retirada pelo solicitante, revogação/reativação de acesso e associação de identidades permanecem como decisões e fluxos separados. Não acrescentar uma unicidade de solicitação pendente que impeça nova tentativa após expiração sem definir o procedimento correspondente.

## 4. `app_private.audit_entries`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | `uuid` | Chave primária. |
| `church_id` | `uuid` | Igreja auditada; FK sem cascata. |
| `action` | `text` | Ação definida pelo comando; 1–80 caracteres. |
| `actor_user_id` | `uuid` | Conta Auth do ator de aplicação; opcional na manutenção controlada. |
| `actor_source` | `text` | `application` ou `maintenance`. |
| `maintenance_operator` | `text` | Identificação do operador de manutenção, obrigatória nessa origem; não é um segredo. |
| `target_type` | `text` | Tipo lógico do alvo; escolhido pelo comando, não pelo cliente. |
| `target_id` | `uuid` | Identificador do alvo, validado pelo comando. |
| `details` | `jsonb` | Objeto limitado a 4096 bytes; campos permitidos por operação. |
| `occurred_at` | `timestamptz` | Instante do servidor. |

Origem de aplicação exige conta autora. Manutenção exige identificação controlada do operador; permite diferenciar quem inicializou o ambiente de quem recebeu o papel de admin. O alvo polimórfico não é uma FK: cada comando valida existência e igreja.

Não registrar senha, segredo, token completo ou link de recuperação. O limite de tamanho não garante ausência de dados sensíveis; comandos usam lista explícita de campos. O admin não ganha permissão direta para editar/apagar auditoria. Retenção e consulta acompanham o histórico de um ano, com detalhes ainda a implementar.

## 5. Arquivos e validação

1. [Pré-verificação somente leitura](../sql/003_preflight_access_requests.sql): todos os campos devem ser `true`.
2. [Ensaio transacional](../sql/003_validate_access_requests_and_audit.sql): executa a estrutura, verifica RLS/privilégios, auditoria com ator e formato válidos e rejeição de aprovação no vencimento/depois; termina em `ROLLBACK`.
3. [Criação permanente](../sql/003_access_requests_and_audit.sql): apenas após validar o ensaio, uma vez; termina em `COMMIT`.
4. [Verificação posterior somente leitura](../sql/004_verify_access_requests_and_audit.sql): seis tabelas, RLS habilitada, privilégios diretos bloqueados e índice/FK presentes.

O ensaio usa apenas dados temporários da aplicação, sem inserir usuários no Auth. Os UUIDs fictícios aparecem em entradas que precisam falhar em CHECKs específicos, antes das FKs. Não testa uma aprovação válida com identidade real, autorização de admin, emissão/resgate concorrentes ou API.

Resultado final esperado do ensaio: `PASS: incremento ensaiado; alterações desfeitas; estrutura inicial preservada`. As duas tabelas novas, o índice e a unicidade auxiliar devem ser desfeitos; as quatro tabelas anteriores continuam presentes. Erro interrompe o ensaio e exige conferir/corrigir antes da criação permanente.

## 6. Evidências da execução em 02/10/2026

- Pré-verificação: captura com os seis campos `true`, incluindo UTF-8, presença das quatro tabelas anteriores e ausência de convites abertos duplicados.
- Ensaio: responsável confirmou `PASS: incremento ensaiado; alterações desfeitas; estrutura inicial preservada`. Não houve execução local pelo agente.
- Criação permanente: responsável confirmou `Success. No rows returned` ao executar o arquivo 003 com `COMMIT`.
- Verificação: captura com seis tabelas (`access_invitations`, `access_requests`, `audit_entries`, `church_access`, `churches`, `members`), todas com `rls_enabled = true`; três colunas de privilégios `false`; índice de um convite aberto presente (`true`).
- A coluna `consumed_invitation_fk_present` ficou fora da captura; o responsável confirmou por texto `true` em todas as seis linhas.

Essas evidências confirmam a estrutura e os privilégios consultados, não a implementação de resgate, aprovação, auditoria funcional, limites de requisição ou autorização da API. Não repetir o script de criação permanente nem o ensaio que exige ausência dessas tabelas neste projeto agora.

A última captura da Data API mantém `app_private` desmarcado; exposição automática desligada foi informada pelo responsável. Essa configuração não foi reinspecionada após o incremento. Continuar fora da Data API e com exposição automática desligada.

Referências técnicas: [restrições e chaves estrangeiras do PostgreSQL](https://www.postgresql.org/docs/current/ddl-constraints.html) e [controle da Data API no Supabase](https://supabase.com/docs/guides/api/securing-your-api).
