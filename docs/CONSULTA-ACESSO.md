# Consulta do próprio acesso à igreja

A aplicação chama `public.get_my_church_access()`, sem parâmetros de identidade. Somente esta consulta é acessível pela Data API; as tabelas de `app_private` continuam fora dos schemas expostos, com RLS e sem privilégios diretos para `anon`, `authenticated` ou `service_role`.

## Correção da entrega anterior

O PR #2 criou a função em `app_private`, enquanto o cliente RPC utilizava o schema padrão `public`. A função não podia ser encontrada pela API. Conceder EXECUTE no schema privado também não fornecia USAGE ou exposição da API, e abrir o schema inteiro contrariaria o desenho de acesso.

Os scripts corrigidos criam a consulta autorizada em `public`, com identidade de `auth.uid()`, referências qualificadas, SECURITY DEFINER e search_path vazio. A função elevada realiza a autorização explicitamente; RLS não é o mecanismo que restringe seu corpo. Revogam EXECUTE de PUBLIC, anon, authenticated e service_role antes de conceder somente a authenticated, na mesma transação.

A conta precisa ter e-mail confirmado, não estar excluída, não ser anônima e não ter bloqueio vigente. Um bloqueio cuja data já passou não impede a consulta. O vínculo exige onboarding concluído e vínculo, igreja e membro ativos. A função não recebe identidade/papel do navegador, não consulta metadados editáveis para autorizar, não escreve dados e não concede novos vínculos.

## Aplicação manual

Merge do código não instala estes scripts no banco. Eles ficam em docs/sql, fora dos caminhos de migração automática.

1. No SQL Editor do projeto correto, executar inteiro `005_validate_get_my_church_access.sql`. Exigir ausência de erros e a linha final `PASS: ensaio concluído; função e dados de teste não persistidos.`
2. Somente após esse resultado, executar inteiro `005_get_my_church_access.sql`. O COMMIT salva a função e notifica o PostgREST para recarregar o schema.
3. Executar `006_verify_get_my_church_access.sql`: todas as colunas devem ser true.
4. No aplicativo atualizado, entrar com a conta do administrador ou clicar em Tentar novamente. Conferir os dados reais da igreja, membro e perfil.

Não repetir os scripts de criação de tabelas nem de inicialização do administrador. Se já existir `public.get_my_church_access` ou houver permissões inesperadas, os scripts param: conferir o estado antes de substituir algo. Uma função antiga de mesmo nome em app_private, se criada pela entrega anterior, não é usada nem apagada automaticamente.

Manter app_private desmarcado na Data API e manter a exposição automática de tabelas desligada. A consulta não precisa de service_role ou secret key no navegador.

## Ensaio e limites da evidência

O ensaio usa uma conta Auth confirmada existente e cria apenas fixtures novas dentro da transação. Não altera contas Auth ou registros reais existentes. Executa chamadas sob authenticated, anon e service_role e verifica:

- Vínculo próprio básico com nome acentuado aparece, sem conceder admin por metadados.
- Igreja de teste sem vínculo não aparece.
- Revogação do vínculo de teste, membro de teste inativo e igreja de teste inativa retiram o acesso.
- UID sem conta ou ausente não recebe dados.
- anon e service_role não conseguem executar a função.
- ROLLBACK remove a função e todas as fixtures.

Configurar claims no SQL Editor testa a autorização do banco; não comprova validação de JWT pela API ou o login OAuth real. Testes de login de uma segunda conta real confirmada sem vínculo, chamadas HTTP anônimas, logout e troca de conta continuam necessários. A limitação compartilhada de requisições e os estados de concorrência da sessão não são implementados por esta correção.

Os scripts foram revisados localmente, mas a execução no PostgreSQL do projeto depende da etapa manual acima. Não apresentar o ensaio como já executado nem um PR mesclado como consulta já instalada.

## Evolução aprovada: seleção de contexto de igreja

Com as decisões de produto aprovadas para suporte a múltiplos vínculos por conta:

1. **Vínculos múltiplos:** uma mesma conta Auth poderá ter vínculos autorizados em mais de uma igreja (ex.: administradora na igreja A e membro com acesso básico na igreja B).
2. **Seleção explícita de contexto:** a aplicação deverá permitir que o usuário escolha ativamente qual igreja está consultando/operando. A consulta de igrejas disponíveis listará apenas aquelas onde o usuário possui vínculo ativo com onboarding concluído.
3. **Isolamento estrito:** todas as consultas, listagens, permissões e comandos devem ser avaliados exclusivamente no contexto da igreja selecionada. Ser administrador na igreja A não concede nenhum privilégio de administração ou liderança na igreja B.
4. **Invalidação de consultas e cache:** ao alternar a igreja ativa, a aplicação deve invalidar imediatamente dados em cache, estados e consultas anteriores, impedindo qualquer mistura acidental de informações entre igrejas distintas.
5. **Estado da implementação:** a função atual `public.get_my_church_access()` reflete o modelo inicial do piloto. A evolução para suportar seleção explícita de contexto (ou parametrização por `church_id` validada contra os acessos ativos da conta) será desenhada e implementada no incremento de convites e seleção de igreja.

Referências: [funções do banco](https://supabase.com/docs/guides/database/functions), [schemas na API](https://supabase.com/docs/guides/api/using-custom-schemas).
