# Escala do Reino — fluxo inicial de acesso e auditoria

Versão 4 · 3 de outubro de 2026

**Situação:** regras de produto confirmadas e preparação dos contratos de convites de acesso e aprovação de nome para revisão. As quatro tabelas iniciais e o incremento de solicitação/auditoria já foram criados e verificados no Supabase; os fluxos de criação de nova igreja ("Criar minha igreja"), administração em no máximo uma igreja por conta Auth e salvaguardas de continuidade do último administrador foram implementados na aplicação, instalados no piloto (scripts 009/010) e integrados na branch main via PR #7. Este documento detalha os contratos para convites e aprovação de outro nome. Complementa o [PRD](PRD.md), a [arquitetura](ARQUITETURA-BANCO.md), o [schema de acesso](SCHEMA-ACESSO.md) e o [schema de solicitação e auditoria](SCHEMA-APROVACAO-AUDITORIA.md).

## 1. Decisões confirmadas

1. Google ou e-mail/senha gerenciados pelo Supabase Auth; sem CPF.
2. Cadastro básico de membro coleta apenas o nome (`display_name`), sem CPF. Não há campo de e-mail no formulário atual de cadastro. O e-mail do destinatário será informado na emissão do convite.
3. Convite vinculado a membro existente, válido por 72 horas desde a emissão, de uso único.
4. Resgate exige o mesmo e-mail confirmado do destinatário. Encontrar um e-mail na base, isoladamente, não autoriza acesso. Outro endereço exige cancelar/reemitir pelo admin.
5. Um convite pendente por membro. Nova emissão cancela o anterior; se houver solicitação de outro nome pendente de análise vinculada ao convite anterior consumido, a reemissão cancela também essa solicitação antiga de nome, preservando o histórico de auditoria e a linha do convite consumido (sem tentar revogar indevidamente a linha consumida).
6. A pessoa confirma o nome cadastrado ou informa outro. Outro nome aguarda aprovação de admin antes de alterar o membro e liberar acesso.
7. **A aprovação também precisa ocorrer antes do vencimento original de 72 horas.** Enviar a proposta não reinicia nem estende o prazo. Solicitação não aprovada a tempo expira, sem acesso; nova tentativa exige novo convite.
8. **Rejeição encerra a tentativa:** rejeição administrativa da solicitação de outro nome encerra definitivamente a tentativa; nova entrada exige novo convite emitido pelo admin.
9. **Compartilhamento manual do link:** no primeiro incremento de convites, o administrador copia e compartilha o link do convite manualmente com o destinatário (sem envio automático por serviço de e-mail nesta etapa).
10. Login sozinho não libera dados de nenhuma igreja existente, nem concede liderança ou administração.
11. **Criação de uma nova igreja ("Criar minha igreja"):** conta autenticada, com e-mail confirmado e sem administração ativa em outra igreja, pode criar uma nova igreja de forma atômica no servidor (implementada na aplicação, instalada no piloto via scripts 009/010 e integrada à main via PR #7).
12. **Administração em uma única igreja por conta:** uma conta Auth pode possuir administração ativa em no máximo uma igreja por vez em todo o sistema, garantida no banco pelo índice parcial `church_access_single_active_admin_idx`.
13. **Continuidade administrativa:** o último administrador ativo de uma igreja só pode deixar a administração depois que outro administrador elegível assumir, protegida no banco pelas funções `app_private.protect_last_active_admin()` e `app_private.protect_last_active_admin_member()` e gatilhos `church_access_protect_last_admin` e `members_protect_last_admin`. Uma igreja pode ter múltiplos administradores simultâneos; não existe papel de proprietário.
14. **Reutilização de conta e múltiplos vínculos:** a mesma conta Auth pode ser administradora na igreja A e ter acesso básico à igreja B por convite. A conta com múltiplos vínculos deve escolher explicitamente a igreja consultada no aplicativo (`SelectChurchPage`). A troca de igreja invalida consultas anteriores e impede mistura de dados.
15. **Exclusão lógica:** remoção de cadastros pela aplicação é lógica e recuperável, preservando identificadores, histórico e referências. Recuperação exige autorização e auditoria, sem restauração automática de acessos e sem contornar a proteção do último administrador.

**Aviso de implementação:** o fluxo de criação de igreja e salvaguardas de administração encontra-se entregue e integrado na branch main. O fluxo de convites com e-mail, resgate seguro, aprovação de outro nome e integração com a seleção de igreja é o incremento em preparação de contratos nesta etapa. A exclusão lógica recuperável é o incremento seguinte (etapa 4 oficial).

## 2. Identidade e destinatário

O servidor valida a conta autenticada com o Supabase e obtém dela o identificador (`auth.uid()`) e o e-mail confirmado. Não aceitar `user_id`, igreja, papel, e-mail verificado ou destinatário como declarações livres do navegador. Não usar metadados editáveis pelo usuário para conceder permissão.

Comparação técnica proposta: retirar espaços externos e normalizar caixa do e-mail consistentemente com o Auth. Não remover pontos, sufixos `+` ou transformar endereços diferentes em equivalentes. Senhas, tokens e assinaturas não recebem normalização de texto. Nomes/textos de cadastro usam NFC e preservam acentos e apóstrofos; nomes iguais não comprovam identidade física entre contas distintas.

Uma tentativa com e-mail divergente não consome o convite nem revela dados do membro. Conta sem confirmação de e-mail não conclui entrada. Limitar tentativas e não expor em respostas públicas se um e-mail possui cadastro. Encontrar um e-mail na base de dados, isoladamente, não confere qualquer acesso.

## 3. Emissão e reemissão

Proposta de contrato: admin ativo na igreja escolhe membro ativo já existente e informa o e-mail do destinatário (já que o cadastro de membro não exige e-mail prévio). O servidor gera token imprevisível; guarda somente seu resumo criptográfico (`token_digest`), autoria, instante, destinatário e vencimento exatamente 72 horas depois. O link é retornado na resposta da RPC para que o administrador copie e compartilhe manualmente no primeiro incremento.

Emissão serializa pelo membro: bloquear o registro da pessoa antes de conferir/cancelar convite anterior e criar o novo. Se houver convite aberto não consumido, marca `revoked_at` (inclusive se vencido, para desocupar o índice). Se houver solicitação de outro nome pendente de análise vinculada a convite anterior consumido, cancela a solicitação (`status = 'cancelled'`), mantendo o convite consumido intacto (o schema proíbe preencher `revoked_at` em convite consumido). Cancelamento anterior, nova emissão e auditoria ficam na mesma transação; uma falha desfaz tudo. Duas emissões concorrentes não deixam dois convites utilizáveis.

Detalhe físico: índice único `access_invitations_one_open_per_member` para convite não consumido e não cancelado por igreja/membro (`redeemed_at is null and revoked_at is null`). O índice não depende do relógio; uma linha vencida ainda ocupa a posição e precisa ser finalizada transacionalmente pela reemissão antes de inserir a próxima. Preservar seus instantes originais e registrar a razão de substituição na auditoria.

Não criar outro membro nem outra conta Auth ao vincular; um vínculo existente não deve ser duplicado, promovido ou rebaixado silenciosamente.

## 4. Entrada com o nome cadastrado

1. Autenticar e validar o convite antes de mostrar os dados mínimos de confirmação.
2. Mostrar o nome já cadastrado. A pessoa confirma; o servidor confere o valor atual, sem confiar em nomes enviados como identificadores.
3. Na transação, revalidar prazo, destinatário, igreja/membro ativos e ausência de vínculo incompatível. Consumir o convite, registrar a confirmação e criar o vínculo básico com `is_admin = false` e `onboarding_completed_at` preenchido.
4. Registrar a operação na auditoria e confirmar a transação. Só então liberar consultas autorizadas da igreja no contexto ativo.

Proposta: nome em NFC e sem espaços externos equivalente ao cadastro usa a confirmação normal. Uma edição que resulte em outro nome entra na análise administrativa; não usar comparação aproximada para escapar da aprovação.

Reativação de vínculo revogado continua pendente de desenho. Não criar outro vínculo ou apagar o anterior para contornar a unicidade.

## 5. Entrada com outro nome

Proposta de contrato: dentro da validade, validar/consumir o convite e abrir uma solicitação ligada à conta, igreja e membro existentes. Guardar o nome cadastrado naquele instante, o nome proposto, autoria, data e o vencimento original do convite. Não alterar `members.display_name`, nem criar `church_access` ativo.

O consumo impede reutilizar o token. Convite consumido registra a apresentação válida; não é prova de acesso concedido. A solicitação acompanha a aprovação separadamente. Enquanto aguarda, a pessoa vê apenas a situação da própria solicitação, sem cronograma, membros, equipes ou bastidores.

Ao aprovar, revalidar admin ativo, conta/e-mail confirmado ainda correspondente, igreja/membro ativos, solicitação pendente, prazo e unicidades. Bloquear membro/solicitação na ordem comum dos comandos. Atualização do nome do membro existente, concessão básica e auditoria ficam na mesma transação.

Usar o horário atual do servidor na decisão final, inclusive após esperar por um bloqueio: `agora < expires_at`. No instante de vencimento ou depois, não alterar nome nem conceder acesso. Um timestamp capturado antes de esperar não pode autorizar aprovação vencida.

Se vencer, mostrar expiração na consulta da própria solicitação. Expiração deriva do prazo no servidor e não depende de tarefa periódica para impedir aprovação. A nova tentativa exige novo convite e nova solicitação; não alterar o vencimento da antiga.

**Decisões consolidadas de tratamento:** se o cadastro do membro mudar durante a análise, informar o conflito e exigir nova avaliação, sem sobrescrever silenciosamente. A rejeição administrativa encerra definitivamente a tentativa (`status = 'rejected'`); nova entrada exige novo convite emitido pelo admin. A reemissão pelo administrador cancela a solicitação pendente de nome anterior (`status = 'cancelled'`), preservando o histórico de auditoria e a linha consumida anterior (sem tentar revogar a linha consumida). A retirada da proposta pelo próprio solicitante permanece como decisão futura separada.

## 6. Próximas entidades propostas

| Entidade | Finalidade | Dados mínimos a detalhar |
| --- | --- | --- |
| `app_private.access_requests` | Guardar proposta de nome até a decisão, sem conceder acesso | Igreja, membro, convite consumido, conta solicitante, nome original/proposto, emissão da proposta, prazo original, estado de decisão, admin decisor e instante. |
| `app_private.audit_entries` | Registrar ações relevantes na transação que as realiza | Igreja, ação, ator autorizado, origem controlada para inicialização, referência ao alvo, instante e dados mínimos necessários à rastreabilidade. |

As novas entidades ficam fora da Data API, com RLS e acesso direto bloqueado como as tabelas iniciais. As FKs precisam conferir igreja/membro/convite juntos. A solicitação deve referenciar uma apresentação válida pela mesma conta; um `invitation_id` arbitrário não basta. Não criar um segundo cadastro de membro para uma proposta.

Estado técnico da decisão: `pending`, `approved`, `rejected`, `cancelled` ou `expired`; a situação efetiva também considera o prazo. O estado persistido `expired` é opcional para finalização e não exige um decisor humano fictício. Um registro pendente vencido é exibido como expirado e não aceita aprovação. Regras para solicitações simultâneas e sua substituição devem acompanhar a migração e os comandos; índice parcial com `now()` não resolve a expiração.

Essas duas tabelas e as restrições adicionais foram aplicadas pelo responsável em 02/10/2026. O [detalhamento físico e as evidências do segundo incremento](SCHEMA-APROVACAO-AUDITORIA.md) registram o alcance da verificação; os comandos descritos neste fluxo continuam pendentes. Não repetir os scripts de criação já aplicados.

## 7. Auditoria e autorização

Registrar criação de igreja, emissão de convite, substituição/cancelamento, apresentação válida, proposta de nome, aprovação, concessão básica, concessão/revogação de administração, exclusão lógica e recuperação. Não registrar senha, token completo, segredo de provedor, link de recuperação ou dados pessoais desnecessários. Proposta: referências ao alvo e estados; nomes original/proposto permanecem no registro de solicitação, sem duplicação irrestrita no payload de auditoria.

Autoria e datas vêm do servidor. O admin da igreja não pode editar/apagar a auditoria diretamente. A ação só é confirmada se o registro de auditoria for gravado na mesma transação. Manter retenção e visibilidade de acordo com o histórico de um ano já previsto; detalhar acesso e tratamento de pedidos com dados pessoais antes da liberação.

Operações possíveis a detalhar: criar igreja; emitir convite; cancelar convite; validar apresentação; confirmar nome; propor nome; consultar a própria solicitação; listar solicitações da igreja por admin; aprovar; alternar contexto de igreja; recuperar cadastro excluído logicamente.

Cada contrato limita entrada, saída e tentativas, verifica o vínculo/admin atual e usa parâmetros. Chave privilegiada no servidor não substitui autorização; cliente não recebe permissão irrestrita sobre tabelas. Aprovação, criação de igreja e emissão não confiam em campos enviados pelo cliente como `is_admin`.

## 8. Inicialização e concessão de administração

### 8.1 Registro histórico do piloto (procedimento privado de manutenção)

Durante o ensaio piloto inicial, a concessão do primeiro administrador da igreja Ministério Shalom foi realizada mediante intervenção privada e controlada de manutenção no banco de dados. O responsável pelo projeto forneceu os dados reais de localização (endereço e Google Maps), fuso horário IANA e política de duração (`warn`), além de seu identificador Auth obtido após autenticação prévia.

Esse procedimento foi estritamente manual e pontual para viabilizar o piloto inicial, com autoria registrada e distinção entre operador de manutenção e conta beneficiada, sem versionamento de scripts com dados privados no repositório. Esse registro é preservado como histórico técnico de testes e validação de infraestrutura.

### 8.2 Fluxo implementado: criação de nova igreja ("Criar minha igreja")

O fluxo de criação de nova igreja ("Criar minha igreja", limite de 1 administração por conta Auth e salvaguarda do último administrador) foi implementado na aplicação web, validado em laboratório, instalado e verificado no banco do piloto pelos scripts 009/010 e incorporado à branch main no merge `d372a58d600d9d7789b3aec25431542301e5c423` (PR #7):

1. **Requisitos prévios:** o usuário deve estar autenticado via Supabase Auth com e-mail confirmado e não pode possuir administração ativa em nenhuma outra igreja do sistema.
2. **Operação atômica no servidor:** uma função controlada (RPC `create_my_church`) executa em transação única:
   - Cria o registro em `churches` com nome, endereço, link do Google Maps, fuso IANA e política de duração (`warn` ou `block`).
   - Cria o registro de membro em `members` com o nome do criador (`display_name`).
   - Cria o vínculo em `church_access` com `is_admin = true`, `status = 'active'` e `onboarding_completed_at = now()`.
   - Grava a entrada correspondente em `audit_entries`.
   - Grava recibo em `command_receipts` para recuperação idempotente.
3. **Segurança:** o primeiro administrador é consequência dessa operação controlada no servidor; não há campo público no cliente para autoconcessão de privilégios. Criar uma nova igreja não concede acesso a nenhuma igreja pré-existente.
4. **Limite sistêmico:** a garantia de no máximo uma igreja administrada por conta Auth é validada no início da transação e assegurada pelo índice parcial único `church_access_single_active_admin_idx` no banco.

## 9. Verificações antes da liberação

- Mesmo e-mail confirmado: Google e senha; divergência e endereço não confirmado rejeitados.
- Criação de igreja: valida e-mail confirmado, cria igreja/membro/acesso admin/auditoria atomicamente e bloqueia se a conta já administrar outra igreja.
- Limite de 1 admin por conta: tentativa de criar ou assumir administração ativa em segunda igreja falha no servidor e no banco, inclusive sob concorrência.
- Continuidade administrativa: último administrador ativo não pode ser removido, revogado ou desativado sem sucessor ativo elegível já empossado.
- Seleção de contexto: usuário com múltiplos acessos deve escolher a igreja ativa; dados, permissões e listagens ficam restritos à igreja selecionada; troca de igreja invalida cache.
- Nome confirmado libera somente vínculo básico; proposta mantém acesso negado.
- Aprovação antes do vencimento funciona; no vencimento/depois não altera nome nem concede acesso.
- Aprovação que espera bloqueio até depois do vencimento também falha.
- Reemissão concorrente mantém um convite utilizável; o anterior não libera acesso.
- Dois resgates/aprovações concorrentes não duplicam vínculo nem auditoria.
- Membro ou convite de outra igreja é rejeitado; perda da permissão de admin é revalidada.
- Exclusão lógica preserva histórico e identificadores; recuperação exige autorização e auditoria e não restaura acesso automaticamente.
- Falha de auditoria desfaz nome, vínculo, consumo/emissão e decisão da operação correspondente.
- Retentativa após resposta incerta consulta o resultado existente antes de reenviar.
- Conta do painel não recebe papel de aplicativo por associação implícita.

Esses são critérios de aceitação, não testes já executados. Os ensaios da estrutura inicial e do segundo incremento validam somente a cobertura estrutural documentada; não comprovam estes fluxos de ponta a ponta.

Referências técnicas: [validação do usuário pelo Supabase](https://supabase.com/docs/reference/javascript/auth-getuser), [gestão de usuários](https://supabase.com/docs/guides/auth/managing-user-data), [índices parciais](https://www.postgresql.org/docs/current/indexes-partial.html) e [bloqueios de linhas](https://www.postgresql.org/docs/current/explicit-locking.html).
