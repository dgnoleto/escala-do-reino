# Cadastro administrativo da igreja

Incremento solicitado pelo responsável em 18/10/2026. Ensaio SQL S01–S22 aprovado com ROLLBACK, seguido de instalação autorizada no **EscalaReinoLab**, HTTP/Storage reais, cinco casos concorrentes e validação da tela. Após autorização específica, o backend 017 foi instalado no **piloto**, com ensaio prévio, preservação de dados/permissões e abertura do cadastro na sessão existente do administrador em localhost:3000, sem editar os dados reais. O frontend permanece local, sem publicação desta entrega. O seletor de arquivo do Chrome teve uma limitação da extensão; a seleção pela interface não recebeu PASS ponta a ponta. [Ensaio](historico/2026-10-18-ensaio-cadastro-igreja-017.md), [instalação/validação no laboratório](historico/2026-10-18-instalacao-e-validacao-cadastro-igreja-017.md) e [aplicação no piloto](historico/2026-10-18-aplicacao-cadastro-igreja-017-piloto.md).

## Comportamento e hierarquia

- A tela inicial oferece **Dados da Igreja** exclusivamente ao administrador ativo da igreja selecionada. Acesso de membro e liderança sem `is_admin` não autorizam consultar nem alterar esse cadastro.
- A tela abre os dados existentes e permite corrigir o nome da igreja (conforme Issue #22), endereço, link do Google Maps e adicionar, substituir ou remover a logo. O fuso horário aparece para identificar o contexto; este incremento não altera fuso horário, política de duração ou administração.
- A logo aparece também no cabeçalho da igreja para pessoas com acesso autorizado. Isso libera somente a identidade visual, sem abrir o cadastro administrativo a membros.
- Mantém o fluxo separado **Criar minha igreja**, seus requisitos de elegibilidade e a salvaguarda do último administrador.
- Perda de permissão impede leitura/escrita no servidor; troca de sessão ou igreja descarta respostas antigas. Outra edição exige recarregar a versão atual, sem sobrescrita silenciosa.

## Contratos e segurança

`017_church_settings.sql` e a evolução `019_church_name_update.sql` criam/atualizam:

| Recurso | Regra |
|---|---|
| `get_church_settings(church_id)` | Somente admin ativo, com membro ativo, onboarding concluído, e-mail confirmado e conta não excluída, anônima ou bloqueada. Retorna nome, timezone, address, google_maps_url, logo_path e profile_revision. |
| `update_church_settings(church_id, command_id, expected_revision, name, address, google_maps_url, logo_path)` | Mesma autorização, derivada de `auth.uid()`, revalidada após locks; atualização de nome, endereço, maps e logo, com auditoria de `previous_name`/`new_name` e recibo na mesma transação. Sobrecarga retrocompatível de 6 parâmetros mantida. |
| `get_church_logo(church_id)` | Membro autorizado consulta somente a referência da logo atual. |
| `can_access_church_logo(name, write)` | Helper booleano para RLS do Storage; upload exige administração, leitura exige acesso à igreja. Membros leem somente a logo atualmente referenciada. |
| `church_settings_receipts` | Tabela privada, sem grants de cliente, com parâmetros e valores anteriores para rastreabilidade e idempotência. |

Nome da igreja: obrigatório, de 1 a 160 caracteres após normalização canônica em NFC e remoção de espaços nas extremidades (trim). Validação estrita no cliente e no servidor. Preserva o ID da igreja, vínculos litúrgicos, equipes e histórico.

Endereço: opcional, até 500 caracteres. Maps: opcional, HTTPS, hosts Google Maps permitidos, sem credenciais/porta personalizada e até 1.024 caracteres. Campo vazio remove o valor. Não há geocodificação nem API Google paga.

Logo: upload de PNG/JPEG/WebP até 2 MB no bucket **privado** `church-logos`, em `<church_id>/<uuid>.<extensão>`. O servidor rejeita referências de outra igreja e objetos inexistentes. Arquivos não são sobrescritos. A referência no cadastro é alterada somente após upload concluído e confirmação da transação. SVG e formatos executáveis não são aceitos.

As políticas restritivas impedem que políticas permissivas anteriores de outros buckets liberem leitura/escrita neste bucket para `anon`/`authenticated`. Não se alteram grants de tabelas privadas nem se expõem chaves privilegiadas. Revisar também a configuração efetiva do Storage no ambiente do ensaio.

URLs assinadas duram cinco minutos e não são persistidas nos recibos/auditoria. Uma URL já emitida pode continuar válida até expirar após revogação do acesso. A imagem em cache também pode permanecer visível. O cadastro administrativo não depende dessas URLs.

Ao substituir/remover a logo, os arquivos antigos são preservados. Upload interrompido ou edição recusada pode deixar um objeto sem referência. Limpeza de objetos antigos exige rotina própria revisada; não há exclusão automática de arquivos neste incremento.

O cliente retém o comando na sessão da aba, separado por usuário/igreja, antes da chamada de atualização. Resposta perdida bloqueia nova edição; **Verificar salvamento** reenvia o mesmo ID e os mesmos parâmetros. O servidor revalida administração antes de devolver o recibo original. Recarga preserva essa recuperação. O recibo de sucesso precisa corresponder à igreja, comando e revisão esperados.

## Verificação e instalação por ambiente

Testes do componente exercitam navegação, acesso de membro, comandos incertos, troca de sessão, perda de administração, conflito, erro de upload e respostas incompletas com transporte controlado. Isso não comprova RLS, SQL nativo, entrega HTTP ou navegação com banco real.

O lote posterior autorizado comprovou separadamente SQL/RLS, HTTP com arquivos físicos e concorrência real, além dos fluxos de navegador descritos no relatório. A suíte final aprovou 342 testes/39 suítes e build. A limitação do seletor da extensão não deve ser confundida com reprovação do upload real, nem apagada por esse resultado.

Verificação inicial do cliente em 18/10/2026: a suíte completa aprovou 339 testes/39 suítes; após complementar a cobertura, os 11 testes específicos de cadastro da igreja passaram. Build de produção aprovado, com o aviso já conhecido de bundle acima de 500 kB. Essa rodada de cliente não executou SQL nem iniciou serviços. O ensaio SQL posterior foi autorizado separadamente e está registrado no relatório acima.

O preparador `node tools/prepare-church-settings-rehearsal.js` apenas gera `node_modules/.cache/church-settings-rehearsal.sql`, em UTF-8, com hash do instalador exato. Não conecta a banco nem inicia serviço. O artefato remove o `COMMIT` do instalador, instala temporariamente, executa S01–S22 e encerra com **ROLLBACK**, seguido de contraprovas de resíduos. O fragmento `017_rehearsal_cases.sql` não deve ser executado isoladamente. Não incluir o instalador com `\i` dentro de outra transação: seu `COMMIT` encerraria a transação externa.

Sequência antes de liberar:

1. Revisar o candidato 017, as políticas existentes de `storage.objects`, dependências e o alvo exato autorizado.
2. Mediante autorização, preparar base **descartável vazia** com Auth/Storage e a estrutura anterior. Não utilizar o laboratório HTTP com dados existentes nem o piloto. Exige identificar host, porta e banco; o nome da base sozinho não prova isolamento.
3. Na mesma sessão autorizada, configurar `escala.settings_rehearsal=disposable-authorized`, executar o artefato preparado com `ON_ERROR_STOP`, conferir S01–S22 e ROLLBACK. Se houver erro, encerrar a conexão e verificar a preservação externamente. Etapa executada e aprovada em 18/10, conforme relatório; repetir somente por mudança ou falha nova.
4. Ensaiar concorrência real: duas edições com a mesma revisão; replay simultâneo; revogação/desativação durante espera. Confirmar que somente uma edição vence e que autoridade perdida recusa inclusive replay.
5. Após aprovação e autorização separada de instalação, aplicar o candidato com COMMIT e conferir coluna, funções, privilégios, auditoria, recibos e bucket privado.
6. Validar no navegador/HTTP com contas fictícias: admin edita e recarrega; membro e líder sem admin não consultam/escrevem mesmo chamando RPC diretamente; admin de outra igreja é recusado; envio válido e inválido de imagem, assinatura/leitura, tentativa de upload por membro, remoção, perda de conexão e troca de contexto. As provas SQL não enviam arquivos físicos ao Storage.

Etapas 4/5 aprovadas no EscalaReinoLab em 18/10; etapa 6 conferida nos limites do relatório, com seletor de arquivo da extensão pendente. Após conferência e autorização específica, o piloto também recebeu o 017, com ROLLBACK prévio, COMMIT e verificação de preservação. A instalação não deve ser repetida nesses ambientes. As mutações de teste com fixtures permaneceram no laboratório.

Não há autorização implícita para SQL, criação de ambientes, commit/push, merge ou deploy. O código da tela já pode ser revisado, mas ambientes sem o 017 informam que a edição ainda não foi habilitada.
