import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {
  extractAuthRedirectError,
  clearAuthRedirectErrorFromUrl,
  INVITATION_PENDING_TOKEN_KEY,
} from '../src/utils/invitationCommandService.js';

// Prepara diretório de cache em node_modules
const cacheDir = path.resolve(process.cwd(), 'node_modules', '.cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}
const bundlePath = path.join(cacheDir, 'auth-confirmation-recovery.bundle.mjs');

// Transpila os componentes reais de produção substituindo apenas a camada de transporte do Supabase
await build({
  stdin: {
    contents: `
      export { default as App } from './src/App.jsx';
      export { AuthProvider, useAuth } from './src/context/AuthContext.jsx';
      export { default as LoginPage } from './src/components/LoginPage.jsx';
      export { default as InvitationFlowPage } from './src/components/InvitationFlowPage.jsx';
      export { default as AccessPendingPage } from './src/components/AccessPendingPage.jsx';
    `,
    resolveDir: process.cwd(),
    loader: 'jsx',
  },
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['react', 'react-dom', 'lucide-react'],
  plugins: [{
    name: 'auth-review-transport',
    setup(builder) {
      builder.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'transport', namespace: 'auth-review' }));
      builder.onLoad({ filter: /.*/, namespace: 'auth-review' }, () => ({
        contents: `
          export const isSupabaseConfigured = () => true;
          export const supabase = {
            auth: {
              signInWithPassword: (...args) => globalThis.__authTestTransport.auth.signInWithPassword(...args),
              signUp: (...args) => globalThis.__authTestTransport.auth.signUp(...args),
              resetPasswordForEmail: (...args) => globalThis.__authTestTransport.auth.resetPasswordForEmail(...args),
              updateUser: (...args) => globalThis.__authTestTransport.auth.updateUser(...args),
              getSession: (...args) => globalThis.__authTestTransport.auth.getSession(...args),
              signOut: (...args) => globalThis.__authTestTransport.auth.signOut(...args),
              onAuthStateChange: (...args) => globalThis.__authTestTransport.auth.onAuthStateChange(...args),
            },
            schema: (schemaName) => ({
              rpc: (fnName, args) => globalThis.__authTestTransport.rpc(schemaName, fnName, args),
            }),
          };
        `,
        loader: 'js',
      }));
    },
  }],
});

const { App, AuthProvider, useAuth, LoginPage } = await import(pathToFileURL(bundlePath).href);

function visibleText(tree) {
  if (!tree) return '';
  if (typeof tree === 'string') return tree;
  if (Array.isArray(tree)) return tree.map(visibleText).join(' ');
  if (tree.children) return visibleText(tree.children);
  return '';
}

function setupTestEnvironment({
  initialUrl = 'http://localhost:3000/',
  session = null,
} = {}) {
  const sessionStore = new Map();
  const localStore = new Map();
  const listeners = new Map();
  const historyEntries = [initialUrl];

  let currentUrl = new URL(initialUrl);

  const loc = {
    get href() { return currentUrl.href; },
    set href(v) { currentUrl = new URL(v); },
    get origin() { return currentUrl.origin; },
    get pathname() { return currentUrl.pathname; },
    get search() { return currentUrl.search; },
    get hash() { return currentUrl.hash; },
    set hash(v) { currentUrl.hash = v; },
  };

  const win = {
    location: loc,
    sessionStorage: {
      getItem: (k) => sessionStore.get(k) ?? null,
      setItem: (k, v) => sessionStore.set(k, String(v)),
      removeItem: (k) => sessionStore.delete(k),
      clear: () => sessionStore.clear(),
    },
    localStorage: {
      getItem: (k) => localStore.get(k) ?? null,
      setItem: (k, v) => localStore.set(k, String(v)),
      removeItem: (k) => localStore.delete(k),
      clear: () => localStore.clear(),
    },
    history: {
      replaceState: (state, title, url) => {
        const next = new URL(url, currentUrl.href);
        currentUrl = next;
        historyEntries.push(next.href);
      },
      pushState: (state, title, url) => {
        const next = new URL(url, currentUrl.href);
        currentUrl = next;
        historyEntries.push(next.href);
      },
    },
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener: (type, handler) => {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent: (event) => {
      const set = listeners.get(event.type);
      if (set) {
        for (const h of set) h(event);
      }
    },
  };

  globalThis.window = win;
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: win.addEventListener,
    removeEventListener: win.removeEventListener,
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });

  const authCalls = [];
  const rpcCalls = [];
  let authListener = null;

  globalThis.__authTestTransport = {
    auth: {
      signInWithPassword: async (credentials) => {
        authCalls.push({ type: 'signInWithPassword', credentials });
        return { data: { session, user: session?.user }, error: null };
      },
      signUp: async (credentials) => {
        authCalls.push({ type: 'signUp', credentials });
        return { data: { user: { id: 'new-user-id', email: credentials.email }, session: null }, error: null };
      },
      resetPasswordForEmail: async (email, opts) => {
        authCalls.push({ type: 'resetPasswordForEmail', email, opts });
        return { data: {}, error: null };
      },
      updateUser: async (attrs) => {
        authCalls.push({ type: 'updateUser', attrs });
        return { data: { user: { id: 'user-id', ...attrs } }, error: null };
      },
      getSession: async () => {
        authCalls.push({ type: 'getSession' });
        return { data: { session }, error: null };
      },
      signOut: async () => {
        authCalls.push({ type: 'signOut' });
        return { error: null };
      },
      onAuthStateChange: (callback) => {
        authListener = callback;
        return {
          data: {
            subscription: {
              unsubscribe: () => { authListener = null; },
            },
          },
        };
      },
    },
    rpc: async (schemaName, fnName, args) => {
      rpcCalls.push({ schemaName, fnName, args });
      if (fnName === 'get_my_church_access') {
        return { data: [], error: null };
      }
      if (fnName === 'get_invitation_details') {
        return {
          data: [{
            invitation_id: 'inv-uuid-1',
            church_id: 'church-1',
            church_name: 'Igreja Piloto Shalom',
            member_id: 'mem-1',
            recipient_email: 'convidado@exemplo.test',
            registered_name: 'Membro Convidado',
            member_display_name: 'Membro Convidado',
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            is_expired: false,
            is_valid: true,
            status: 'open',
          }],
          error: null,
        };
      }
      return { data: [], error: null };
    },
  };

  return {
    win,
    sessionStore,
    localStore,
    historyEntries,
    authCalls,
    rpcCalls,
    triggerAuthEvent: (event, newSession) => {
      if (authListener) {
        authListener(event, newSession);
      }
    },
    triggerWindowEvent: (type) => {
      const set = listeners.get(type);
      if (set) {
        for (const h of set) h({ type });
      }
    },
  };
}

describe('Issue #24: Confirmação e Recuperação de Conta no Ambiente de Uso (CA01 a CA04)', () => {
  test('1. Unidades: Extração e interpretação de erros de redirecionamento do Supabase Auth (CA03)', () => {
    // 1.1 Hash com link expirado (otp_expired)
    const errHash = extractAuthRedirectError('http://localhost:3000/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    assert.ok(errHash);
    assert.equal(errHash.error, 'access_denied');
    assert.equal(errHash.errorCode, 'otp_expired');
    assert.match(errHash.message, /expirou ou já foi utilizado/);

    // 1.2 Hash com rota de convite e erro anexado
    const errHashRoute = extractAuthRedirectError('http://localhost:3000/#/invite?token=abc&error=access_denied&error_code=otp_expired');
    assert.ok(errHashRoute);
    assert.equal(errHashRoute.errorCode, 'otp_expired');
    assert.match(errHashRoute.message, /expirou ou já foi utilizado/);

    // 1.3 Query string (search) com erro de link expirado
    const errSearch = extractAuthRedirectError('http://localhost:3000/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    assert.ok(errSearch);
    assert.equal(errSearch.errorCode, 'otp_expired');

    // 1.4 Erro genérico access_denied
    const errDenied = extractAuthRedirectError('http://localhost:3000/#error=access_denied&error_description=User+cancelled');
    assert.ok(errDenied);
    assert.match(errDenied.message, /Acesso não autorizado/);

    // 1.5 URLs limpas e legítimas retornam null
    assert.equal(extractAuthRedirectError('http://localhost:3000/'), null);
    assert.equal(extractAuthRedirectError('http://localhost:3000/#/invite?token=6gYjM-t-P_qP83fX8Uo3vW1A-y8lX2a_4vQ-kP0a1b2'), null);
    assert.equal(extractAuthRedirectError('http://localhost:3000/#access_token=valid&type=signup'), null);
  });

  test('2. Unidades: Limpeza segura de fragmentos de erro da barra de endereços (CA03)', () => {
    const env = setupTestEnvironment({
      initialUrl: 'http://localhost:3000/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    });

    assert.ok(env.win.location.hash.includes('otp_expired'));
    clearAuthRedirectErrorFromUrl();
    // Fragmento de erro removido da URL
    assert.equal(env.win.location.hash, '');
    assert.equal(env.win.location.pathname, '/');
  });

  test('3. Integração: Detecção no mount de link expirado exibe orientação clara e segura na UI (CA03)', async () => {
    const env = setupTestEnvironment({
      initialUrl: 'http://localhost:3000/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      session: null,
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(App));
      await new Promise((r) => setTimeout(r, 40));
    });

    const text = visibleText(renderer.toJSON());
    assert.match(text, /O link de confirmação ou recuperação expirou ou já foi utilizado/);
    assert.match(text, /Por favor, solicite um novo envio para continuar/);

    // A URL foi sanitizada via history.replaceState
    assert.equal(env.win.location.hash, '');

    act(() => renderer.unmount());
  });

  test('4. Integração: hashchange reativo com erro atualiza mensagem de erro na UI (CA03)', async () => {
    const env = setupTestEnvironment({
      initialUrl: 'http://localhost:3000/',
      session: null,
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(App));
      await new Promise((r) => setTimeout(r, 40));
    });

    // Simula clique em link expirado que direciona para a aba existente via hashchange
    env.win.location.hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    await act(async () => {
      env.triggerWindowEvent('hashchange');
      await new Promise((r) => setTimeout(r, 40));
    });

    const text = visibleText(renderer.toJSON());
    assert.match(text, /O link de confirmação ou recuperação expirou ou já foi utilizado/);
    act(() => renderer.unmount());
  });

  test('5. Primeiro Acesso: Preservação do token de convite e definição autônoma de senha (CA02)', async () => {
    const syntheticInviteToken = '6gYjM-t-P_qP83fX8Uo3vW1A-y8lX2a_4vQ-kP0a1b2';
    const env = setupTestEnvironment({
      initialUrl: `http://localhost:3000/#/invite?token=${syntheticInviteToken}`,
      session: null,
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(App));
      await new Promise((r) => setTimeout(r, 40));
    });

    // 5.1 Token extraído para sessionStorage e URL limpa
    assert.equal(env.sessionStore.get(INVITATION_PENDING_TOKEN_KEY), syntheticInviteToken);
    assert.equal(env.win.location.hash, '');

    // 5.2 Interface seleciona automaticamente primeiro acesso (cadastro)
    const text = visibleText(renderer.toJSON());
    assert.match(text, /Você recebeu um convite/);
    assert.match(text, /É meu primeiro acesso — Criar conta/);

    // 5.3 A pessoa define a própria senha (campos de senha preenchidos em memória)
    const emailInput = renderer.root.findByProps({ id: 'login-email-input' });
    const passInput = renderer.root.findByProps({ id: 'login-password-input' });
    const confirmInput = renderer.root.findByProps({ id: 'login-confirm-password' });

    await act(async () => {
      emailInput.props.onChange({ target: { value: 'convidado@exemplo.test' } });
      passInput.props.onChange({ target: { value: 'MinhaSenhaSegura123!' } });
      confirmInput.props.onChange({ target: { value: 'MinhaSenhaSegura123!' } });
    });

    // 5.4 Submete cadastro
    const form = renderer.root.findByProps({ className: 'login-email-form' });
    await act(async () => {
      form.props.onSubmit({ preventDefault() {} });
      await new Promise((r) => setTimeout(r, 40));
    });

    // 5.5 Confirmação pendente exigida pelo Supabase Auth (data.session = null)
    const pendingText = visibleText(renderer.toJSON());
    assert.match(pendingText, /Confirme seu e-mail para continuar/);
    assert.match(pendingText, /Cadastro realizado! Enviamos um e-mail de confirmação/);
    assert.match(pendingText, /Próximos passos para resgatar seu convite/);

    // 5.6 Senhas NÃO foram expostas nem salvas em storage
    assert.equal(env.localStore.size, 0);
    assert.equal(env.sessionStore.has('password'), false);
    assert.equal(env.sessionStore.has('login-password-input'), false);

    // 5.7 O convite permanece rigorosamente retido em sessionStorage
    assert.equal(env.sessionStore.get(INVITATION_PENDING_TOKEN_KEY), syntheticInviteToken);

    // 5.8 Quando a conta é confirmada e autenticada (ex: retorno da confirmação)
    const confirmedSession = {
      user: {
        id: 'usr-confirmed-101',
        email: 'convidado@exemplo.test',
        email_confirmed_at: new Date().toISOString(),
      },
    };

    await act(async () => {
      env.triggerAuthEvent('SIGNED_IN', confirmedSession);
      await new Promise((r) => setTimeout(r, 40));
    });

    // 5.9 App direciona automaticamente para a jornada do convite (InvitationFlowPage)
    const flowText = visibleText(renderer.toJSON());
    assert.match(flowText, /Igreja Piloto Shalom/);
    assert.match(flowText, /Membro Convidado/);

    act(() => renderer.unmount());
  });

  test('6. Recuperação de Senha: Envio, evento PASSWORD_RECOVERY e atualização de senha (CA01 & CA02)', async () => {
    const env = setupTestEnvironment({
      initialUrl: 'http://localhost:3000/',
      session: null,
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(App));
      await new Promise((r) => setTimeout(r, 40));
    });

    // 6.1 Usuário acessa modo "Esqueci minha senha"
    const forgotBtn = renderer.root.findByProps({ id: 'btn-forgot-password' });
    await act(async () => {
      forgotBtn.props.onClick();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.match(visibleText(renderer.toJSON()), /Recuperação de Senha/);

    // 6.2 Preenche e envia solicitação de recuperação
    const resetEmailInput = renderer.root.findByProps({ id: 'login-reset-email' });
    await act(async () => {
      resetEmailInput.props.onChange({ target: { value: 'membro@exemplo.test' } });
    });

    const resetForm = renderer.root.findByProps({ className: 'login-email-form' });
    await act(async () => {
      resetForm.props.onSubmit({ preventDefault() {} });
      await new Promise((r) => setTimeout(r, 30));
    });

    // Verifica que resetPasswordForEmail foi disparado com o redirectTo do ambiente
    const resetCall = env.authCalls.find((c) => c.type === 'resetPasswordForEmail');
    assert.ok(resetCall);
    assert.equal(resetCall.email, 'membro@exemplo.test');
    assert.equal(resetCall.opts.redirectTo, 'http://localhost:3000');

    // 6.3 Simula retorno do link de recuperação recebendo evento PASSWORD_RECOVERY
    const recoverySession = {
      user: {
        id: 'usr-recovery-99',
        email: 'membro@exemplo.test',
      },
    };

    await act(async () => {
      env.triggerAuthEvent('PASSWORD_RECOVERY', recoverySession);
      await new Promise((r) => setTimeout(r, 40));
    });

    // Interface abre formulário "Definir Nova Senha"
    assert.match(visibleText(renderer.toJSON()), /Definir Nova Senha/);

    // 6.4 Usuário informa nova senha válida
    const newPassInput = renderer.root.findByProps({ id: 'login-new-password' });
    const confirmNewPassInput = renderer.root.findByProps({ id: 'login-confirm-new-password' });

    await act(async () => {
      newPassInput.props.onChange({ target: { value: 'NovaSenhaForte2026!' } });
      confirmNewPassInput.props.onChange({ target: { value: 'NovaSenhaForte2026!' } });
    });

    const updateForm = renderer.root.findByProps({ className: 'login-email-form' });
    await act(async () => {
      updateForm.props.onSubmit({ preventDefault() {} });
      await new Promise((r) => setTimeout(r, 40));
    });

    // 6.5 updateUser chamado com a nova senha escolhida pela própria pessoa
    const updateCall = env.authCalls.find((c) => c.type === 'updateUser');
    assert.ok(updateCall);
    assert.equal(updateCall.attrs.password, 'NovaSenhaForte2026!');

    act(() => renderer.unmount());
  });

  test('7. Garantia de Invariantes: Botão "Voltar ao login" em update_password permite sair com segurança (CA03)', async () => {
    const env = setupTestEnvironment({
      initialUrl: 'http://localhost:3000/',
      session: null,
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(App));
      await new Promise((r) => setTimeout(r, 40));
    });

    await act(async () => {
      env.triggerAuthEvent('PASSWORD_RECOVERY', { user: { id: 'test-u' } });
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.match(visibleText(renderer.toJSON()), /Definir Nova Senha/);

    // Clica em "Voltar ao login"
    const cancelBtn = renderer.root.findByProps({ id: 'btn-cancel-update-password' });
    await act(async () => {
      cancelBtn.props.onClick();
      await new Promise((r) => setTimeout(r, 20));
    });

    // Retornou ao formulário normal de login
    assert.match(visibleText(renderer.toJSON()), /Entrar com E-mail/);

    act(() => renderer.unmount());
  });
});
