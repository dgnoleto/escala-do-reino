# Escala do Reino — Roteiro de Ensaio em Navegador Real com Backend Local (013)

**Incremento:** 013 — Ciclo de Vida de Membros (Listagem Administrativa com Filtros, Restauração Elegível e Tratamento de Respostas)  
**Documento Normativo:** `docs/ROTEIRO-NAVEGADOR-LOCAL-013.md`  
**Referência do Frontend:** `src/components/MembersPage.jsx` e `src/utils/memberCommandService.js`  
**Referência do Backend:** `docs/sql/013_member_lifecycle.sql` e `docs/sql/014_verify_member_lifecycle.sql`

---

## 1. Princípios de Governança, Isolamento e Autenticação Nativa

1. **Preservação Estrita do Ambiente Habitual:**
   - A aplicação habitual em execução na porta 3000 aponta para o piloto remoto Supabase HTTPS. **Nenhuma mutação ou teste desta etapa deve ser executado na porta 3000**.
   - O arquivo `.env` principal do repositório **NÃO deve ser modificado** por conveniência de teste.
2. **Execução de Processo Frontend Dedicado (Porta 3001):**
   - Para os ensaios locais autorizados, executa-se uma instância separada do Vite em porta alternativa (ex: 3001), configurada explicitamente para o endpoint HTTP local do laboratório:
     - URL da API Kong: `http://127.0.0.1:55331`
     - Chave pública cliente: chave `anon` pública do laboratório (disponibilizada pelo Kong local).
     - **PROIBIÇÃO DE SERVICE_ROLE:** É terminantemente proibido utilizar a chave `service_role` no cliente ou no navegador.
3. **Autenticação Nativa via Navegador (Sem Injeção SQL):**
   - O serviço Auth local existente (`supabase_auth_escala-convites-http-lab`) deve ser iniciado (quando expressamente autorizado pelo responsável).
   - O operador deve autenticar-se **diretamente no formulário de login do navegador**, digitando sua senha no campo próprio.
   - **NÃO solicitar nem registrar senhas ou tokens nos relatórios ou artefatos**.
   - **NÃO cadastrar usuários diretamente via SQL em `auth.users` alegando que isso comprova autenticação nativa**. A autenticação nativa exige passagem pelo fluxo HTTP do GoTrue/Supabase Auth com emissão legítima de JWT e refresh token.

---

## 2. Preparação do Frontend Temporário (Porta 3001)

### Comando de Inicialização (PowerShell):
```powershell
# Execução na raiz do repositório (d:\Github\escala-do-reino)
# Sobrescreve as variáveis de ambiente em tempo de execução sem alterar o arquivo .env:
$env:VITE_SUPABASE_URL = "http://127.0.0.1:55331"
$env:VITE_SUPABASE_ANON_KEY = "<CHAVE_ANON_PUBLICA_DO_LAB>"
npx vite --port 3001 --strictPort
```

O operador acessa via navegador: `http://localhost:3001`.

---

## 3. Preparação de Dados Fictícios Delimitados para a Jornada

O inventário conferido em 16/10/2026 possui **7 membros ativos e 0 inativos**. Para testar a listagem com filtros e a restauração, **NÃO inativar membros existentes da igreja por conveniência**.

Sob autorização expressa, insere-se na igreja de laboratório um conjunto mínimo e identificado de dados fictícios para a jornada do navegador:
1. **Membro Fictício 1 (Elegível para Restauração):**  
   - `display_name = 'Membro Teste Elegivel'`
   - `status = 'inactive'`
   - Sem vínculo em `church_access`.
2. **Membro Fictício 2 (Com Acesso Previamente Revogado):**  
   - `display_name = 'Membro Teste Acesso Revogado'`
   - `status = 'inactive'`
   - Vínculo em `church_access` com `status = 'revoked'`.
3. **Membro Fictício 3 (Inconsistência de Acesso Ativo Legado - Guarda P0018):**  
   - `display_name = 'Membro Teste Legado Ativo'`
   - `status = 'inactive'`
   - Vínculo em `church_access` com `status = 'active'` (simulando inconsistência para provar a guarda).

---

## 4. Roteiro Passo a Passo de Ensaios no Navegador Real

| Passo | Caso de Teste | Ação no Navegador | Comportamento Esperado na Interface | Camadas de Evidência e Prova |
| :---: | :--- | :--- | :--- | :--- |
| **J1** | **Filtros Administrativos: Ativos / Inativos / Todos** | 1. Autenticar como administrador.<br>2. Acessar a tela de Gestão de Membros.<br>3. Alternar entre as abas: "Ativos", "Inativos" e "Todos". | - Aba "Ativos": exibe apenas membros com badge verde "Ativo" (botão "Restaurar" ausente).<br>- Aba "Inativos": exibe os membros com badge cinza "Inativo" e o botão "Restaurar" disponível.<br>- Aba "Todos": exibe a contagem consolidada e todos os cadastros. | **HTTP:** Chamada POST a `/rest/v1/rpc/list_church_members_admin` com `p_status_filter = 'active'/'inactive'/'all'`.<br>**Componente:** Transição de estado em `applyMemberListTransition`.<br>**Navegador:** Renderização condicional dos badges e botões de ação na tabela. |
| **J2** | **Paginação e Reposicionamento Automático** | 1. Com filtro "Inativos" ativo, navegar para uma página com registros.<br>2. Executar restauração do último membro inativo da página. | - O item restaurado sai da lista de inativos.<br>- Se a página atual ficar sem registros, o componente reposiciona automaticamente o usuário na última página válida (ou página 1). | **Componente:** `MembersPage.jsx` (linhas 277-287 - cálculo de `lastPage`).<br>**Navegador:** Atualização visual imediata do número de página e da tabela sem quebrar o layout. |
| **J3** | **Restauração Elegível Ordinária** | 1. Localizar "Membro Teste Elegivel" na aba "Inativos".<br>2. Clicar em "Restaurar".<br>3. No modal de confirmação, conferir texto explicativo:<br>*"A restauração reativa o membro no rol da igreja para escalas. Esta operação não concede acesso ao aplicativo."*<br>4. Clicar em "Confirmar Restauração". | - Botão exibe spinner com texto "Restaurando…".<br>- Modal fecha automaticamente.<br>- Exibe banner de sucesso verde: *"Membro \"Membro Teste Elegivel\" restaurado com sucesso!"*.<br>- Lista recarrega e o membro agora aparece na aba "Ativos". | **SQL:** Transação atômica em `restore_church_member`, `audit_entries` (action: `restore_member`) e `command_receipts`.<br>**HTTP:** Status 200 OK com payload estruturado.<br>**Navegador:** Fechamento do modal, toast/banner de sucesso e atualização de dados. |
| **J4** | **Persistência dos Dados Após Recarga (F5)** | 1. Após a restauração do passo J3, pressionar F5 no navegador para recarregar a página por completo. | - O membro permanece na situação "Ativo".<br>- Não há retorno indevido para o estado inativo (prova que a mutação é durável no banco físico e não apenas estado volátil em memória). | **SQL:** Consulta direta em `members` confirma `status = 'active'`.<br>**Navegador:** Estado recarregado via requisição fresca de listagem ao servidor. |
| **J5** | **Nota Explicativa de Vínculo de Acesso Revogado** | 1. Na aba "Inativos", clicar em "Restaurar" para "Membro Teste Acesso Revogado".<br>2. Observar o conteúdo do modal de confirmação. | - O modal exibe com destaque o quadro explicativo:<br>**Nota sobre acesso:** *"A restauração reativa apenas o cadastro do membro nesta igreja. O acesso a esta igreja permanece revogado. A recuperação desse acesso depende de um fluxo separado, ainda não disponível nesta etapa."*<br>3. Confirmar a restauração. | **SQL:** Membro passa a `status = 'active'`. A tabela `church_access` permanece estritamente com `status = 'revoked'`. O recibo retorna `has_revoked_access: true`.<br>**Componente:** `MembersPage.jsx` renderiza o aviso de segurança.<br>**Navegador:** Clareza total para o operador de que a liderança/acesso NÃO foram devolvidos. |
| **J6** | **Guarda de Bloqueio de Acesso Legado Ativo (P0018)** | 1. Na aba "Inativos", tentar restaurar "Membro Teste Legado Ativo".<br>2. Clicar em "Confirmar Restauração". | - A operação é bloqueada pelo servidor (P0018).<br>- O modal exibe banner vermelho de erro específico:<br>*"Este membro possui um vínculo de acesso ativo legado nesta igreja. A restauração foi bloqueada para proteger a integridade do acesso."*<br>- O modal não fecha; nenhuma alteração de status ocorre. | **SQL:** Erro P0018 disparado no passo 4 da RPC `restore_church_member`. Zero mutação.<br>**HTTP:** Status 400 com código P0018 no corpo JSON.<br>**Componente:** Mapeamento de P0018 em mensagem compreensível.<br>**Navegador:** Exibição do banner de erro em vermelho no modal. |
| **J7** | **Perda e Reconciliação de Resposta (Interrupção de Rede)** | 1. Abrir DevTools do navegador (F12) -> aba Network -> selecionar modo "Offline".<br>2. Clicar em "Confirmar Restauração" em um membro inativo.<br>3. O comando não obtém resposta do servidor.<br>4. Reativar a rede ("Online").<br>5. Observar o banner de recuperação / incerteza exibido na interface. | - A interface retém a identidade da operação no `sessionStorage` (`savePendingLifecycleCommand`).<br>- Exibe aviso de resposta incerta.<br>- Botão de reenvio/verificação segura permite reenviar o mesmo `command_id` sem duplicar a ação. | **Componente:** `isUncertainResponse`, armazenamento em `sessionStorage`.<br>**HTTP:** Timeout/NetworkError -> POST subsequente com replay seguro.<br>**Navegador:** Recuperação de interface sem perda do estado de trabalho. |
| **J8** | **Isolamento de Contexto e Conta** | 1. Disparar uma requisição de restauração ou listagem.<br>2. Alternar imediatamente de igreja no seletor ou clicar em "Sair" (logout) antes da resposta chegar. | - A resposta da requisição anterior é descartada silenciosamente (`isCurrentContext` retorna false).<br>- Nenhum dado da igreja anterior é injetado na nova tela.<br>- Previne mutação cruzada entre congregações. | **Componente:** Guardas `isMountedRef` e `isCurrentContext(targetChurchId, targetUserId)`.<br>**Navegador:** Ausência de alertas espúrios ou telas inconsistentes. |

---

## 5. Matriz de Separação de Camadas de Evidência

> [!CAUTION]
> **Regra de Rigor Científico:**  
> **Não declarar uma classe de evidência comprovada por outra**. Cada camada deve ser comprovada com seus próprios artefatos concretos:
> - Teste unitário em Node.js (jsdom/react-test-renderer) **não comprova** renderização real em navegador.
> - Sucesso de chamada SQL no psql **não comprova** usabilidade, acessibilidade ou contrato de interface web.
> - Requisição HTTP via curl **não comprova** experiência de usuário ou tratamento de erro no componente.

| Camada de Evidência | O Que Ela Prova | O Que Ela NÃO Prova | Instrumento de Coleta |
| :--- | :--- | :--- | :--- |
| **Evidência SQL** | Integridade transacional, monotonicidade de timestamps, RLS, integridade de constraints, gravação atômica em `audit_entries` e `command_receipts`. | Não prova conformidade de payload JSON com a biblioteca cliente Supabase-js nem tratamento de layout na tela. | Consultas diretas via `psql` (SELECT em tabelas e logs do PostgreSQL). |
| **Evidência HTTP / API** | Contrato de entrada/saída das RPCs, headers de CORS, códigos HTTP (200, 400, 403), formato de serialização JSON de matrizes e objetos. | Não prova como o navegador reage visualmente nem o gerenciamento de foco e modais. | Logs do Kong local (porta 55331) e aba Network do DevTools do navegador. |
| **Evidência de Componente** | Máquina de estados de lista (`applyMemberListTransition`), persistência de chaves idempotentes no `sessionStorage`, debounce e cancelamento de contextos obsoletos. | Não prova execução real do motor CSS/Blink do navegador nem comportamento de rede física. | Suítes de testes automatizados (`test/member-lifecycle-cycle.test.js`). |
| **Evidência de Navegador Real** | Experiência real do usuário humano, renderização de cores e ícones, visibilidade de modais, fluxo de autenticação com cookies/tokens, recarga F5 e comportamento responsivo. | Não substitui a conferência profunda de constraints e concorrência no banco de dados. | Captura de tela, gravação de sessão do operador e inspeção visual do DOM. |
