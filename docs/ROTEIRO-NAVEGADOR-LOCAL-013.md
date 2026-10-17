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
$env:VITE_SUPABASE_PUBLISHABLE_KEY = "<CHAVE_ANON_PUBLICA_DO_LAB>"
npx vite --port 3001 --strictPort
```

> [!NOTE]
> `src/lib/supabaseClient.js` lê explicitamente a variável de ambiente `VITE_SUPABASE_PUBLISHABLE_KEY` (comportamento canônico do cliente). A chave pública do laboratório local deve ser atribuída a essa variável.

O operador acessa via navegador: `http://localhost:3001`.

---

## 3. Preparação de Dados Fictícios Delimitados para a Jornada

> [!IMPORTANT]
> **Distinção entre Igrejas do Laboratório:**
> - **Igreja Efêmera do Ensaio SQL (`01300000-0000-4000-8000-0000000000c1`):** Criada e destruída exclusivamente pelos scripts automatizados de concorrência (`013_concurrency_session_a.sql` e `session_b.sql`). Não deve ser confundida com a base de ensaio no navegador.
> - **Igreja Persistente do Navegador (`<LAB_CHURCH_PERSISTENT_ID>`):** Congregação do laboratório local onde a conta nativa do operador possui acesso administrativo legítimo (`is_admin = true`). O inventário conferido em 16/10/2026 possui **7 membros ativos e 0 inativos**. Para testar a listagem com filtros, paginação e a restauração, **NÃO inativar membros existentes da igreja por conveniência**.

Como o tamanho de página configurado na aplicação é `pageSize = 10` (`MembersPage.jsx:133`), a validação de paginação e reposicionamento automático (J2) requer volume de dados suficiente para ultrapassar uma página (mínimo de 11 inativos).

### Delimitação Estrita de Volume para J2 (Exatamente 11 Inativos no Filtro)
> [!IMPORTANT]
> Se fixtures de diferentes cenários forem inseridas simultaneamente sem controle de volume, o filtro de inativos atingirá 13 registros (11 de paginação + 1 revogado + 1 legado ativo). Nesse caso, restaurar o 11º item deixará ainda 2 itens na Página 2, **não ocorrendo o reposicionamento automático para a Página 1**.
>
> Para que o teste de reposicionamento J2 seja determinístico, o volume total de membros inativos na congregação durante J2 deve ser de **EXATAMENTE 11 registros**:
> - **9 membros preenchedores da Página 1:** `display_name = 'Membro Teste Inativo 01'` até `'09'`.
> - **1 membro inativo com vínculo revogado:** `display_name = 'Membro Teste Acesso Revogado'` (10º item da Página 1, aproveitado subsequentemente no teste J5).
> - **1 membro isolado na Página 2:** `display_name = 'Membro Teste Inativo 11'` (único registro na Página 2; ao ser restaurado, a Página 2 zera e aciona o reposicionamento automático para a Página 1).
> - **Membro com Vínculo Legado Ativo (J6):** Só deve ser inserido no banco **APÓS a conclusão da validação de J2**, preservando o volume estrito de 11 registros durante o teste de paginação.

### Manifesto de Identificadores e Procedimento de Limpeza do Navegador
As fixtures de ensaio de navegador utilizam UUIDs dedicados no espaço `013b0000-0000-4000-8000-0000000000xx`, vinculados à igreja persistente (`<LAB_CHURCH_PERSISTENT_ID>`):
- Preenchedores (J2): `013b0000-0000-4000-8000-000000000001` a `...0009`
- Acesso Revogado (J2/J5): `013b0000-0000-4000-8000-000000000010` (church_access: `013b0000-0000-4000-8000-00000000ac10`, status: 'revoked', revoked_at: '2026-10-15T10:00:00Z', reason: 'rehearsal_j5')
- Alvo de Reposicionamento (J2): `013b0000-0000-4000-8000-000000000011`
- Legado Ativo (J6, inserido pós-J2): `013b0000-0000-4000-8000-000000000012` (church_access: `013b0000-0000-4000-8000-00000000ac12`, status: 'active')

```sql
-- Script de Limpeza e Reversão Exata das Fixtures de Navegador (Executar pós-jornada):
-- Deleta recibos e auditorias EXCLUSIVAMENTE vinculados aos membros restaurados nesta jornada
-- (sem assumir prefixo fictício em command_id nem usar coluna inexistente user_id em audit_entries)
delete from app_private.command_receipts
where church_id = '<LAB_CHURCH_PERSISTENT_ID>'
  and action = 'restore_member'
  and result_member_id in (
    '013b0000-0000-4000-8000-000000000001',
    '013b0000-0000-4000-8000-000000000010',
    '013b0000-0000-4000-8000-000000000011'
  );

delete from app_private.audit_entries
where church_id = '<LAB_CHURCH_PERSISTENT_ID>'
  and action = 'restore_member'
  and target_id in (
    '013b0000-0000-4000-8000-000000000001',
    '013b0000-0000-4000-8000-000000000010',
    '013b0000-0000-4000-8000-000000000011'
  );

delete from app_private.church_access
where id in (
  '013b0000-0000-4000-8000-00000000ac10',
  '013b0000-0000-4000-8000-00000000ac12'
);

-- Deleção estrita dos 12 membros da jornada por lista de IDs exatos do manifesto (sem faixa ou range genérico)
delete from app_private.members
where church_id = '<LAB_CHURCH_PERSISTENT_ID>'
  and id in (
    '013b0000-0000-4000-8000-000000000001',
    '013b0000-0000-4000-8000-000000000002',
    '013b0000-0000-4000-8000-000000000003',
    '013b0000-0000-4000-8000-000000000004',
    '013b0000-0000-4000-8000-000000000005',
    '013b0000-0000-4000-8000-000000000006',
    '013b0000-0000-4000-8000-000000000007',
    '013b0000-0000-4000-8000-000000000008',
    '013b0000-0000-4000-8000-000000000009',
    '013b0000-0000-4000-8000-000000000010',
    '013b0000-0000-4000-8000-000000000011',
    '013b0000-0000-4000-8000-000000000012'
  );
```

---

## 4. Roteiro Passo a Passo de Ensaios no Navegador Real

| Passo | Caso de Teste | Ação no Navegador | Comportamento Esperado na Interface | Camadas de Evidência e Prova |
| :---: | :--- | :--- | :--- | :--- |
| **J1** | **Filtros Administrativos: Ativos / Inativos / Todos** | 1. Autenticar com conta de administrador nativo.<br>2. Acessar a tela de Gestão de Membros.<br>3. Alternar entre as abas: "Ativos", "Inativos" e "Todos". | - Aba "Ativos": exibe apenas membros com badge verde "Ativo" (botão "Restaurar" ausente).<br>- Aba "Inativos": exibe os membros com badge cinza "Inativo" e o botão "Restaurar" disponível para os elegíveis.<br>- Aba "Todos": exibe a contagem consolidada e todos os cadastros. | **HTTP:** Chamada POST a `/rest/v1/rpc/list_church_members_admin` com `p_status_filter = 'active'/'inactive'/'all'`.<br>**Componente:** Transição de estado em `applyMemberListTransition`.<br>**Navegador:** Renderização condicional dos badges e botões de ação na tabela. |
| **J2** | **Paginação e Reposicionamento Automático (pageSize=10 com Exatamente 11 Inativos)** | 1. Com filtro "Inativos" ativo e exatamente 11 membros inativos, navegar para a Página 2.<br>2. Observar a exibição isolada de "Membro Teste Inativo 11" (único registro na página).<br>3. Clicar em "Restaurar" nesse único membro da página e confirmar no modal. | - O item restaurado sai da lista de inativos.<br>- Como a Página 2 fica com 0 registros, o componente recalcula `lastPage` e reposiciona automaticamente o usuário na Página 1.<br>- A Página 1 recarrega exibindo os 10 itens restantes. | **Componente:** `MembersPage.jsx` (cálculo de `lastPage` e reposicionamento automático).<br>**Navegador:** Atualização visual imediata do número de página ativo (de 2 para 1) e da tabela sem quebrar o layout. |
| **J3** | **Restauração Elegível Ordinária** | 1. Localizar "Membro Teste Inativo 01" na aba "Inativos".<br>2. Clicar em "Restaurar".<br>3. No modal de confirmação, conferir texto explicativo:<br>*"A restauração reativa o membro no rol da igreja para escalas. Esta operação não concede acesso ao aplicativo."*<br>4. Clicar em "Confirmar Restauração". | - Botão exibe spinner com texto "Restaurando…".<br>- Modal fecha automaticamente.<br>- Exibe banner de sucesso verde: *"Membro \"Membro Teste Inativo 01\" restaurado com sucesso!"*.<br>- Lista recarrega e o membro agora aparece na aba "Ativos". | **SQL:** Transação atômica em `restore_church_member`, `audit_entries` (action: `restore_member`) e `command_receipts`.<br>**HTTP:** Status 200 OK com payload estruturado.<br>**Navegador:** Fechamento do modal, toast/banner de sucesso e atualização de dados. |
| **J4** | **Persistência dos Dados Após Recarga (F5)** | 1. Após a restauração do passo J3, pressionar F5 no navegador para recarregar a página por completo. | - O membro permanece na situação "Ativo".<br>- Não há retorno indevido para o estado inativo (prova que a mutação é durável no banco físico e não apenas estado volátil em memória). | **SQL:** Consulta direta em `members` confirma `status = 'active'`.<br>**Navegador:** Estado recarregado via requisição fresca de listagem ao servidor. |
| **J5** | **Nota Explicativa de Vínculo de Acesso Revogado** | 1. Na aba "Inativos", clicar em "Restaurar" para "Membro Teste Acesso Revogado".<br>2. Observar o conteúdo do modal de confirmação. | - O modal exibe com destaque o quadro explicativo:<br>**Nota sobre acesso:** *"A restauração reativa apenas o cadastro do membro nesta igreja. O acesso a esta igreja permanece revogado. A recuperação desse acesso depende de um fluxo separado, ainda não disponível nesta etapa."*<br>3. Confirmar a restauração. | **SQL:** Membro passa a `status = 'active'`. A tabela `church_access` permanece estritamente com `status = 'revoked'`. O recibo retorna `has_revoked_access: true`.<br>**Componente:** `MembersPage.jsx` renderiza o aviso de segurança.<br>**Navegador:** Clareza total para o operador de que a liderança/acesso NÃO foram devolvidos. |
| **J6** | **Guarda de Bloqueio de Acesso Legado Ativo (UI + P0018)** | 1. Inserir a fixture de J6 (`Membro Teste Legado Ativo`).<br>2. Na aba "Inativos", localizar "Membro Teste Legado Ativo".<br>3. Observar a coluna de ações da tabela.<br>4. (Opcional/API) Disparar a chamada `restore_church_member` via console DevTools para o mesmo membro. | - **Na UI:** O botão "Restaurar" NÃO é renderizado. Em seu lugar, a interface exibe o indicador bloqueado `<Lock /> Acesso ativo legado` com title explicativo.<br>- **Na API / Backend:** A chamada direta à RPC é rejeitada pelo passo 4 com erro `P0018` (HTTP 400), comprovando defesa em profundidade (trava de UI + guarda no banco). | **Componente:** `MembersPage.jsx` (linhas 1273–1280) substitui o botão pelo indicador de trava.<br>**SQL / HTTP:** Código P0018 retornado se a RPC for chamada por fora da interface. Zero mutação no cadastro. |
| **J7** | **Tratamento de Rede: Offline Preventivo vs Resposta Perdida Pós-Commit** | **Etapa A (Offline Preventivo):**<br>1. Abrir DevTools (F12) -> Network -> selecionar "Offline".<br>2. Abrir modal de restauração de membro inativo.<br>3. Verificar estado do botão "Confirmar Restauração".<br><br>**Etapa B (Resposta Perdida Pós-Commit via Interceptor):**<br>1. No Console DevTools, injetar o interceptor que descarta a resposta após receber o HTTP 200:<br>`const origFetch = window.fetch; window.fetch = async (...args) => { const r = await origFetch(...args); if (args[0]?.toString().includes('restore_church_member')) { window.fetch = origFetch; throw new TypeError('Failed to fetch (simulated lost response after commit)'); } return r; };`<br>2. Clicar em "Confirmar Restauração".<br>3. Observar disparo do erro simulado no console após o commit do PostgreSQL.<br>4. Reenviar o comando seguro via banner de incerteza da UI. | **Etapa A:** O botão fica desabilitado (`disabled={restoring \|\| !isOnline}`), impedindo envio às cegas.<br><br>**Etapa B:**<br>- O comando retém o `commandId` no `sessionStorage`.<br>- A interface exibe o banner de resposta incerta.<br>- O reenvio seguro com o mesmo `commandId` (idempotência C3) recupera o recibo já gravado no servidor, sem duplicar efeitos. | **Componente:** `isOnline`, `isUncertainResponse`, retenção em `sessionStorage`.<br>**SQL:** 1 único registro em `command_receipts` e 1 única auditoria em `audit_entries`.<br>**Navegador:** Reconciliação transparente sem perda de trabalho comprovada no cliente web. |
| **J8** | **Isolamento de Contexto de Congregação no Cliente (Conta Multi-Igreja)** | 1. **Pré-requisito:** Respeito à trava estrutural `church_access_single_active_admin_idx`: nenhuma conta pode ser administradora ativa (`is_admin = true` e `status = 'active'`) em duas igrejas simultaneamente.<br>Configurar a conta de teste com **administração ativa na Igreja 1 e acesso regular na Igreja 2**:<br>`select church_id, is_admin, status from app_private.church_access where user_id = '<ID_CONTA_NATIVA>' and status = 'active';`<br>(retorna 2 linhas: Igreja 1 com `is_admin = true`, Igreja 2 com `is_admin = false`).<br>*(Para testar telas administrativas em ambas as congregações, utilizam-se duas contas distintas de administrador: Conta A para Igreja 1 e Conta B para Igreja 2).*<br>2. Disparar uma requisição de listagem ou restauração na Igreja 1.<br>3. Alternar imediatamente para a Igreja 2 no seletor de congregação antes da chegada da resposta. | - A resposta pendente da Igreja 1 é descartada no cliente (`isCurrentContext` retorna false).<br>- Nenhum dado da Igreja 1 é renderizado na tela da Igreja 2.<br>- **Nota de Rigor:** O descarte no cliente protege a interface contra mistura visual de congregações; a garantia de isolamento transacional decorre do RLS e validações no servidor. | **Componente:** Guardas `isMountedRef` e `isCurrentContext(targetChurchId, targetUserId)`.<br>**Navegador:** Ausência de alertas espúrios ou telas inconsistentes na alternância entre igrejas autorizadas. |

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
