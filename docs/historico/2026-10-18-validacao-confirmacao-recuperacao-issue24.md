# Escala do Reino — Validação de Confirmação e Recuperação de Conta (Issue #24)

**Data:** 18/10/2026
**Referência:** [Issue #24](https://github.com/dgnoleto/escala-do-reino/issues/24) · [Pull Request #50](https://github.com/dgnoleto/escala-do-reino/pull/50)
**Branch de trabalho:** `feat/issue-22-editar-nome-igreja`
**Escopo:** Tratamento da confirmação e recuperação de conta no ambiente de uso, reutilizando os fluxos de acesso entregues, com tratamento seguro de expiração e preservação do primeiro acesso por convite.

---

## 1. Resumo da Entrega e Critérios de Aceite

| Critério | Descrição | Status | Evidência |
| :--- | :--- | :---: | :--- |
| **CA01** | Confirmação e recuperação chegam a uma conta de teste autorizada e levam ao fluxo correto do ambiente | **PASS** | `test/auth-confirmation-recovery.test.js` (Cenário 6): `resetPasswordForEmail` com `redirectTo` dinâmico do ambiente, evento `PASSWORD_RECOVERY` abrindo `update_password` e persistência via `updateUserPassword`. |
| **CA02** | Primeiro acesso preserva a retomada do convite válido; a pessoa define a própria senha, sem expô-la em logs, documentos ou chat | **PASS** | `test/auth-confirmation-recovery.test.js` (Cenário 5): extração do token de convite para `sessionStorage`, formulário de primeiro acesso com senha autônoma, retenção do token durante confirmação pendente e redirecionamento automático para `InvitationFlowPage` após autenticação. Ausência de senhas em storage confirmada. |
| **CA03** | Falha ou expiração apresenta orientação segura; não desabilitar confirmação de e-mail nem relaxar a autorização para fazer o teste passar | **PASS** | `test/auth-confirmation-recovery.test.js` (Cenários 1, 2, 3, 4 e 7): funções `extractAuthRedirectError` e `clearAuthRedirectErrorFromUrl` tratam `otp_expired` e `access_denied`, sanitizam a barra de endereços via `replaceState` e exibem orientação protetiva na UI sem relaxar regras de confirmação. |
| **CA04** | Registrar ambiente e limites da evidência, distinguindo entrega real de e-mail de testes locais já aceitos | **PASS** | Seção 3 deste relatório e atualizações normativas em `docs/acesso/CONTRATO-CONVITES-ACESSO.md`, `docs/PRD.md` e `docs/ESTADO-ATUAL.md`. |

---

## 2. Modificações no Código de Produção

1. **Utilitário de Captura e Sanitização de Erros de Autenticação (`src/utils/invitationCommandService.js`):**
   - Implementada a função `extractAuthRedirectError(locationObj)`: detecta parâmetros de erro do Supabase Auth no fragmento hash (`#error=access_denied&error_code=otp_expired...`) ou na query search (`?error=...`), mapeando códigos técnicos para mensagens claras e amigáveis ao usuário (*"O link de confirmação ou recuperação expirou ou já foi utilizado. Por favor, solicite um novo envio para continuar."*).
   - Implementada a função `clearAuthRedirectErrorFromUrl()`: remove exclusivamente os fragmentos e parâmetros de erro da barra de navegação via `window.history.replaceState`, preservando a rota base e quaisquer outros parâmetros legítimos sem poluir o histórico ou Referer.

2. **Contexto de Autenticação (`src/context/AuthContext.jsx`):**
   - Inicialização do estado `authError` com verificação de erro de redirecionamento no carregamento da aplicação (`extractAuthRedirectError()`), com sanitização imediata da URL.
   - Atualização de `clearAccessContext({ preserveAuthError })` para que transições de desautenticação inicial não apaguem mensagens legítimas de links expirados antes da leitura do usuário.
   - Monitoramento reativo de `hashchange` para captura de erros de redirecionamento que ocorram na mesma aba aberta.

3. **Interface de Acesso (`src/components/LoginPage.jsx`):**
   - Alerta de erro de autenticação (`login-alert--error`) exibe as mensagens de expiração em destaque.
   - Desativação do estado `emailConfirmationPending` caso um erro de expiração seja detectado, permitindo ao usuário reexecutar a ação ou solicitar nova recuperação imediatamente.
   - Adicionado botão *"Voltar ao login"* (`#btn-cancel-update-password`) no modo de redefinição de senha (`update_password`) para saída segura sem travamento.
   - Atribuído `id="btn-forgot-password"` ao botão de recuperação de senha.

---

## 3. Limites da Evidência e Segurança Operacional (CA04)

- **Ambiente de Testes Automatizados:** Os 7 testes unitários e de integração real implementados em `test/auth-confirmation-recovery.test.js` executam sobre componentes reais de produção com emulação controlada da camada de transporte do Supabase via `esbuild`. Validam o comportamento exato da UI, ciclo de vida de componentes, integridade de storage e sanitização de URL.
- **Ambiente de Uso / Piloto Supabase (`jvpctgqudvjealzileib`):** O projeto de piloto possui o serviço de Auth padrão ativo com confirmação de e-mail estritamente habilitada e obrigatória. As credenciais e configurações de SMTP externo e DNS permanecem restritas à autorização específica e não foram alteradas nesta entrega, conforme a diretriz de refinamento da issue.
- **Privacidade de Credenciais:** Assegurado que senhas, tokens de uso único e dados confidenciais residem exclusivamente em memória transitória durante submissão, sem gravação em storage, logs de console ou documentos.

---

## 4. Validação Técnica Executada

1. **Suíte Dedicada de Confirmação e Recuperação:**
   - Comando: `node --test test/auth-confirmation-recovery.test.js`
   - Resultado: **7 testes passando** (1 suíte, 0 falhas, duração ~620ms).
2. **Suíte Global de Testes do Projeto:**
   - Comando: `npm test`
   - Resultado: **383 testes passando** (42 suítes, 0 falhas, duração ~6.6s).
3. **Build de Produção:**
   - Comando: `npm run build`
   - Resultado: **Vite build concluído com sucesso** (`dist/` gerado sem erros de compilação ou sintaxe).
