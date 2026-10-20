# Consulta do próprio acesso à igreja

A aplicação chama `public.get_my_church_access()`, sem parâmetros de identidade, para obter o vínculo autorizado inicial do usuário. Conforme informado pelo responsável nas etapas concluídas (incluindo a instalação de `009_create_my_church.sql` e verificação `010` em 06/10/2026), a Data API expõe sete funções RPC de produto em `public` com permissão restrita a `authenticated` (`get_my_church_access`, `list_church_members`, `create_church_member`, `get_create_member_receipt`, `check_church_creation_eligibility`, `create_my_church` e `get_create_church_receipt`), enquanto as sete tabelas de `app_private` permanecem estritamente fora dos schemas expostos, com RLS habilitada e sem privilégios diretos para `anon`, `authenticated` ou `service_role`.

## Correção da entrega anterior

O PR #2 criou a função em `app_private`, enquanto o cliente RPC utilizava o schema padrão `public`. A função não podia ser encontrada pela API. Conceder EXECUTE no schema privado também não fornecia USAGE ou exposição da API, e abrir o schema inteiro contrariaria o desenho de acesso.

Os scripts corrigidos criam a consulta autorizada em `public`, com identidade de `auth.uid()`, referências qualificadas, SECURITY DEFINER e search_path vazio. A função elevada realiza a autorização explicitamente; RLS não é o mecanismo que restringe seu corpo. Revogam EXECUTE de PUBLIC, anon, authenticated e service_role antes de conceder somente a authenticated, na mesma transação.

A conta precisa ter e-mail confirmado, não estar excluída, não ser anônima e não ter bloqueio vigente. Um bloqueio cuja data já passou não impede a consulta. O vínculo exige onboarding concluído e vínculo, igreja e membro ativos. A função não recebe identidade/papel do navegador, não consulta metadados editáveis para autorizar, não escreve dados e não concede novos vínculos.

## Registro da aplicação (etapa concluída)

A instalação permanente de `public.get_my_church_access()` foi realizada pelo responsável no projeto Supabase na etapa de correção de acesso, após ensaio prévio com `ROLLBACK` e verificação (005/006). Não repetir os scripts de criação de tabelas, o bootstrap ou as instalações já concluídas. Se já existir `public.get_my_church_access` ou houver permissões inesperadas, os scripts param: conferir o estado antes de substituir algo.

Manter `app_private` desmarcado na Data API e manter a exposição automática de tabelas desligada. A consulta não precisa de service_role ou secret key no navegador.

## Ensaio e limites da evidência

O ensaio usa uma conta Auth confirmada existente e cria apenas fixtures novas dentro da transação. Não altera contas Auth ou registros reais existentes. Executa chamadas sob authenticated, anon e service_role e verifica:

- Vínculo próprio básico com nome acentuado aparece, sem conceder admin por metadados.
- Igreja de teste sem vínculo não aparece.
- Revogação do vínculo de teste, membro de teste inativo e igreja de teste inativa retiram o acesso.
- UID sem conta ou ausente não recebe dados.
- anon e service_role não conseguem executar a função.
- ROLLBACK remove a função e todas as fixtures.

Configurar claims no SQL Editor testa a autorização do banco; não comprova validação de JWT pela API ou o login OAuth real. Testes de login de uma segunda conta real confirmada sem vínculo, chamadas HTTP anônimas, logout e troca de conta continuam necessários. A limitação compartilhada de requisições e os estados de concorrência da sessão não são implementados por esta correção.

O responsável pelo projeto informou a conclusão com sucesso do ensaio transacional com `ROLLBACK` (`005_validate_get_my_church_access.sql`), da instalação autorizada de `public.get_my_church_access()` (`005_get_my_church_access.sql`) e da verificação pós-instalação (`006_verify_get_my_church_access.sql`). Esses resultados constituem evidências informadas pelo responsável, sem constituir nova inspeção direta do Supabase neste incremento. Permanecem pendentes as validações com login OAuth e JWT real no navegador, chamadas sob concorrência e proteções em camada de borda.

## Evolução aprovada: seleção de contexto de igreja

Com as decisões de produto aprovadas para suporte a múltiplos vínculos por conta:

1. **Vínculos múltiplos:** uma mesma conta Auth poderá ter vínculos autorizados em mais de uma igreja (ex.: administradora na igreja A e membro com acesso básico na igreja B).
2. **Seleção explícita de contexto:** a aplicação deverá permitir que o usuário escolha ativamente qual igreja está consultando/operando. A consulta de igrejas disponíveis listará apenas aquelas onde o usuário possui vínculo ativo com onboarding concluído.
3. **Isolamento estrito:** todas as consultas, listagens, permissões e comandos devem ser avaliados exclusivamente no contexto da igreja selecionada. Ser administrador na igreja A não concede nenhum privilégio de administração ou liderança na igreja B.
4. **Invalidação de consultas e cache:** ao alternar a igreja ativa, a aplicação deve invalidar imediatamente dados em cache, estados e consultas anteriores, impedindo qualquer mistura acidental de informações entre igrejas distintas.
5. **Estado da implementação:** a interface web já implementou a seleção explícita de contexto (`SelectChurchPage`, função `selectChurch` no `AuthContext`) com invalidação imediata de cache e consultas no PR #7 (integrado na `main`). Novos vínculos autorizados criados via resgate de convite alimentarão diretamente esse seletor, mantendo o isolamento estrito entre igrejas.

Referências: [funções do banco](https://supabase.com/docs/guides/database/functions), [schemas na API](https://supabase.com/docs/guides/api/using-custom-schemas).
