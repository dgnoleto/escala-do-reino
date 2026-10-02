# Escala do Reino — fluxo inicial de acesso e auditoria

Versão 2 · 2 de outubro de 2026

**Situação:** regras de produto confirmadas e proposta dos próximos contratos. As quatro tabelas iniciais já foram criadas e verificadas no Supabase; este documento não cria tabelas, funções, contas ou permissões adicionais. Complementa o [PRD](PRD.md), a [arquitetura](ARQUITETURA-BANCO.md) e o [schema inicial](SCHEMA-ACESSO.md).

## 1. Decisões confirmadas

1. Google ou e-mail/senha gerenciados pelo Supabase Auth; sem CPF.
2. Convite vinculado a membro existente, válido por 72 horas desde a emissão, de uso único.
3. Resgate exige o mesmo e-mail confirmado do destinatário. Outro endereço exige cancelar/reemitir pelo admin.
4. Um convite pendente por membro. Nova emissão cancela o anterior.
5. A pessoa confirma o nome cadastrado ou informa outro. Outro nome aguarda aprovação de admin antes de alterar o membro e liberar acesso.
6. **A aprovação também precisa ocorrer antes do vencimento original de 72 horas.** Enviar a proposta não reinicia nem estende o prazo. Solicitação não aprovada a tempo expira, sem acesso; nova tentativa exige novo convite.
7. Login sozinho não libera dados da igreja, liderança ou admin. Admin não define nem consulta senha alheia.

## 2. Identidade e destinatário

O servidor valida a conta autenticada com o Supabase e obtém dela o identificador e o e-mail confirmado. Não aceitar `user_id`, igreja, papel, e-mail verificado ou destinatário como declarações livres do navegador. Não usar metadados editáveis pelo usuário para conceder permissão.

Comparação técnica proposta: retirar espaços externos e normalizar caixa do e-mail consistentemente com o Auth. Não remover pontos, sufixos `+` ou transformar endereços diferentes em equivalentes. Senhas, tokens e assinaturas não recebem normalização de texto. Nomes/textos de cadastro usam NFC e preservam acentos e apóstrofos; nomes iguais não comprovam identidade.

Uma tentativa com e-mail divergente não consome o convite nem revela dados do membro. Conta sem confirmação de e-mail não conclui entrada. Limitar tentativas e não expor em respostas públicas se um e-mail possui cadastro.

## 3. Emissão e reemissão

Proposta de contrato: admin ativo na igreja escolhe membro ativo já existente e destinatário. O servidor gera token imprevisível; guarda somente seu resumo, autoria, instante e vencimento exatamente 72 horas depois.

Emissão serializa pelo membro: bloquear o registro da pessoa antes de conferir/cancelar o convite anterior e criar o novo. Cancelamento anterior, nova emissão e auditoria ficam na mesma transação; uma falha desfaz tudo. Duas emissões concorrentes não deixam dois convites utilizáveis.

Detalhe físico proposto: índice único para um convite não consumido/não cancelado por igreja/membro, combinado com a transação. O índice não pode depender do horário atual para excluir convites expirados; a reemissão precisa tratar também a linha vencida antes de inserir a próxima. Preservar seus instantes originais e registrar a razão de substituição na auditoria. Esse índice ainda não foi aplicado.

## 4. Entrada com o nome cadastrado

1. Autenticar e validar o convite antes de mostrar os dados mínimos de confirmação.
2. Mostrar o nome já cadastrado. A pessoa confirma; o servidor confere o valor atual, sem confiar em nomes enviados como identificadores.
3. Na transação, revalidar prazo, destinatário, igreja/membro ativos e ausência de vínculo incompatível. Consumir o convite, registrar a confirmação e criar o vínculo básico com `is_admin = false` e `onboarding_completed_at` preenchido.
4. Registrar a operação na auditoria e confirmar a transação. Só então liberar consultas autorizadas da igreja.

Proposta: nome em NFC e sem espaços externos equivalente ao cadastro usa a confirmação normal. Uma edição que resulte em outro nome entra na análise administrativa; não usar comparação aproximada para escapar da aprovação.

Reativação de vínculo revogado continua pendente de desenho. Não criar outro vínculo ou apagar o anterior para contornar a unicidade.

## 5. Entrada com outro nome

Proposta de contrato: dentro da validade, validar/consumir o convite e abrir uma solicitação ligada à conta, igreja e membro existentes. Guardar o nome cadastrado naquele instante, o nome proposto, autoria, data e o vencimento original do convite. Não alterar `members.display_name`, nem criar `church_access` ativo.

O consumo impede reutilizar o token. Convite consumido registra a apresentação válida; não é prova de acesso concedido. A solicitação acompanha a aprovação separadamente. Enquanto aguarda, a pessoa vê apenas a situação da própria solicitação, sem cronograma, membros, equipes ou bastidores.

Ao aprovar, revalidar admin ativo, conta/e-mail confirmado ainda correspondente, igreja/membro ativos, solicitação pendente, prazo e unicidades. Bloquear membro/solicitação na ordem comum dos comandos. Atualização do nome do membro existente, concessão básica e auditoria ficam na mesma transação.

Usar o horário atual do servidor na decisão final, inclusive após esperar por um bloqueio: `agora < expires_at`. No instante de vencimento ou depois, não alterar nome nem conceder acesso. Um timestamp capturado antes de esperar não pode autorizar aprovação vencida.

Se vencer, mostrar expiração na consulta da própria solicitação. Expiração deriva do prazo no servidor e não depende de tarefa periódica para impedir aprovação. A nova tentativa exige novo convite e nova solicitação; não alterar o vencimento da antiga.

**Tratamentos ainda propostos:** se o cadastro do membro mudar durante a análise, informar o conflito e exigir nova avaliação, sem sobrescrever silenciosamente. Rejeição, retirada da proposta e efeito de reemissão sobre uma solicitação já aberta precisam de definição antes de implementar esses comandos.

## 6. Próximas entidades propostas

| Entidade | Finalidade | Dados mínimos a detalhar |
| --- | --- | --- |
| `app_private.access_requests` | Guardar proposta de nome até a decisão, sem conceder acesso | Igreja, membro, convite consumido, conta solicitante, nome original/proposto, emissão da proposta, prazo original, estado de decisão, admin decisor e instante. |
| `app_private.audit_entries` | Registrar ações relevantes na transação que as realiza | Igreja, ação, ator autorizado, origem controlada para inicialização, referência ao alvo, instante e dados mínimos necessários à rastreabilidade. |

As novas entidades ficam fora da Data API, com RLS e acesso direto bloqueado como as tabelas iniciais. As FKs precisam conferir igreja/membro/convite juntos. A solicitação deve referenciar uma apresentação válida pela mesma conta; um `invitation_id` arbitrário não basta. Não criar um segundo cadastro de membro para uma proposta.

Estado técnico da decisão: `pending`, `approved`, `rejected`, `cancelled` ou `expired`; a situação efetiva também considera o prazo. O estado persistido `expired` é opcional para finalização e não exige um decisor humano fictício. Um registro pendente vencido é exibido como expirado e não aceita aprovação. Regras para solicitações simultâneas e sua substituição devem acompanhar a migração e os comandos; índice parcial com `now()` não resolve a expiração.

Essas tabelas não foram criadas. O [detalhamento físico e os scripts do segundo incremento](SCHEMA-APROVACAO-AUDITORIA.md) estão preparados para ensaio, sem repetir o script que criou as quatro tabelas existentes.

## 7. Auditoria e autorização

Registrar emissão, substituição/cancelamento, apresentação válida, proposta de nome, aprovação, concessão e inicialização do admin. Não registrar senha, token completo, segredo de provedor, link de recuperação ou dados pessoais desnecessários. Proposta: referências ao alvo e estados; nomes original/proposto permanecem no registro de solicitação, sem duplicação irrestrita no payload de auditoria.

Autoria e datas vêm do servidor. O admin da igreja não pode editar/apagar a auditoria diretamente. A ação só é confirmada se o registro de auditoria for gravado na mesma transação. Manter retenção e visibilidade de acordo com o histórico de um ano já previsto; detalhar acesso e tratamento de pedidos com dados pessoais antes da liberação.

Operações possíveis a detalhar: emitir convite; cancelar convite; validar apresentação; confirmar nome; propor nome; consultar a própria solicitação; listar solicitações da igreja por admin; aprovar. Rejeição/cancelamento de solicitação e revogação/reativação exigem os detalhes pendentes.

Cada contrato limita entrada, saída e tentativas, verifica o vínculo/admin atual e usa parâmetros. Chave privilegiada no servidor não substitui autorização; cliente não recebe permissão irrestrita sobre tabelas. Aprovação e emissão não confiam em um `is_admin` enviado pelo navegador.

## 8. Inicialização do primeiro admin

O responsável pelo projeto confirmou que será o primeiro admin. Nome e e-mail indicados estão guardados somente na preparação local; não há vínculo de admin concedido. Procedimento operacional ainda sem execução:

1. Identificar a igreja real e conferir os dados da pessoa já indicada pelo responsável pelo piloto.
2. Essa pessoa autentica no aplicativo; validar conta e e-mail confirmado pelo Supabase. Entrar no painel administrativo do Supabase não cria uma conta de usuário do aplicativo.
3. Um procedimento de manutenção restrito cria igreja/membro/vínculo de admin e registra a inicialização atomicamente. Conferir identidades e unicidades antes da concessão.
4. Testar acesso limitado àquela igreja; emissão passa a acontecer pelos comandos autorizados.

O primeiro usuário a entrar não vira admin automaticamente. Não oferecer bootstrap público, senha escolhida pelo admin ou edição livre de papel pelo cliente. Autoria inicial precisa distinguir o operador de manutenção da conta que recebe a concessão; não falsificar a autoria atribuindo-a ao novo admin.

Faltam os dados reais da igreja, a autenticação da pessoa indicada no aplicativo e seu identificador Auth, fuso/local e política padrão de duração. A escolha `warn`/`block` precisa ser explícita no cadastro, pois o SQL inicial não colocou um padrão silencioso.

## 9. Verificações antes da liberação

- Mesmo e-mail confirmado: Google e senha; divergência e endereço não confirmado rejeitados.
- Nome confirmado libera somente vínculo básico; proposta mantém acesso negado.
- Aprovação antes do vencimento funciona; no vencimento/depois não altera nome nem concede acesso.
- Aprovação que espera bloqueio até depois do vencimento também falha.
- Reemissão concorrente mantém um convite utilizável; o anterior não libera acesso.
- Dois resgates/aprovações concorrentes não duplicam vínculo nem auditoria.
- Membro ou convite de outra igreja é rejeitado; perda da permissão de admin é revalidada.
- Falha de auditoria desfaz nome, vínculo, consumo/emissão e decisão da operação correspondente.
- Retentativa após resposta incerta consulta o resultado existente antes de reenviar.
- Conta do painel não recebe papel de aplicativo por associação implícita.

Esses são critérios de aceitação, não testes já executados. O ensaio do incremento anterior valida somente a estrutura inicial e sua cobertura documentada.

Referências técnicas: [validação do usuário pelo Supabase](https://supabase.com/docs/reference/javascript/auth-getuser), [gestão de usuários](https://supabase.com/docs/guides/auth/managing-user-data), [índices parciais](https://www.postgresql.org/docs/current/indexes-partial.html) e [bloqueios de linhas](https://www.postgresql.org/docs/current/explicit-locking.html).
