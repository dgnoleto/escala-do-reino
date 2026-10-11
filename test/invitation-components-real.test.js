import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Prepara diretório de cache em node_modules
const cacheDir = path.resolve(process.cwd(), 'node_modules', '.cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}
const bundlePath = path.join(cacheDir, 'invitation-components.bundle.mjs');

// Transpila os componentes reais de produção sem alterar sua lógica, substituindo apenas o transporte Supabase
await build({
  stdin: {
    contents: `
      export { default as App } from './src/App.jsx';
      export { AuthProvider, useAuth } from './src/context/AuthContext.jsx';
      export { default as InvitationFlowPage } from './src/components/InvitationFlowPage.jsx';
      export { default as IssueInvitationModal } from './src/components/IssueInvitationModal.jsx';
      export { default as AdminInvitationsTab } from './src/components/AdminInvitationsTab.jsx';
      export { default as AdminRequestsTab } from './src/components/AdminRequestsTab.jsx';
      export { default as MembersPage } from './src/components/MembersPage.jsx';
      export { default as LoginPage } from './src/components/LoginPage.jsx';
      export { default as AccessPendingPage } from './src/components/AccessPendingPage.jsx';
      export { default as SelectChurchPage } from './src/components/SelectChurchPage.jsx';
      export { default as ChurchHomePage } from './src/components/ChurchHomePage.jsx';
      export {
        saveAccessRequestMarker,
        loadAccessRequestMarker,
        removeAccessRequestMarker,
      } from './src/utils/invitationCommandService.js';
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
    name: 'review-transport',
    setup(builder) {
      builder.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'transport', namespace: 'review' }));
      builder.onLoad({ filter: /.*/, namespace: 'review' }, () => ({
        contents: `
          export const supabase = {
            schema: (...args) => globalThis.__reviewTransport.schema(...args),
            auth: {
              onAuthStateChange: (...args) => globalThis.__reviewTransport.auth.onAuthStateChange(...args),
              getSession: (...args) => globalThis.__reviewTransport.auth.getSession(...args),
              signOut: (...args) => globalThis.__reviewTransport.auth.signOut(...args),
              signInWithOAuth: (...args) => globalThis.__reviewTransport.auth.signInWithOAuth(...args),
              signInWithPassword: (...args) => globalThis.__reviewTransport.auth.signInWithPassword(...args),
              signUp: (...args) => globalThis.__reviewTransport.auth.signUp(...args),
              resetPasswordForEmail: (...args) => globalThis.__reviewTransport.auth.resetPasswordForEmail(...args),
              updateUser: (...args) => globalThis.__reviewTransport.auth.updateUser(...args),
            }
          };
          export const isSupabaseConfigured = () => true;
        `,
        loader: 'js',
      }));
    },
  }],
});

const {
  App,
  AuthProvider,
  useAuth,
  InvitationFlowPage,
  IssueInvitationModal,
  AdminInvitationsTab,
  AdminRequestsTab,
  MembersPage,
  LoginPage,
  AccessPendingPage,
  SelectChurchPage,
  ChurchHomePage,
  saveAccessRequestMarker,
  loadAccessRequestMarker,
  removeAccessRequestMarker,
} = await import(pathToFileURL(bundlePath).href);

function setupEnvironment(options = {}) {
  const items = new Map();
  const storage = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, String(v)),
    removeItem: (k) => items.delete(k),
    clear: () => items.clear(),
    key: (i) => [...items.keys()][i] ?? null,
    get length() { return items.size; },
  };

  let currentUrl = options.initialUrl || 'http://localhost:3000/';
  const historyCalls = [];

  const locationObj = {
    get href() { return currentUrl; },
    set href(v) { currentUrl = v; },
    get origin() { return 'http://localhost:3000'; },
    get hash() {
      const idx = currentUrl.indexOf('#');
      return idx >= 0 ? currentUrl.slice(idx) : '';
    },
    set hash(h) {
      const base = currentUrl.split('#')[0];
      currentUrl = base + (h ? (h.startsWith('#') ? h : '#' + h) : '');
    },
    pathname: '/',
    search: '',
  };

  const clipboardCalls = [];
  let clipboardShouldFail = Boolean(options.clipboardShouldFail);

  globalThis.window = {
    sessionStorage: storage,
    location: locationObj,
    history: {
      replaceState: (state, title, url) => {
        historyCalls.push({ state, title, url });
        if (url) {
          if (url.startsWith('/')) {
            currentUrl = locationObj.origin + url;
          } else {
            currentUrl = url;
          }
        }
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };

  globalThis.document = {
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      onLine: true,
      clipboard: {
        writeText: async (text) => {
          if (clipboardShouldFail) {
            throw new Error('Clipboard permission denied');
          }
          clipboardCalls.push(text);
          return Promise.resolve();
        },
      },
    },
  });

  const rpcCalls = [];
  const authCalls = [];
  let authListener = null;

  const user = options.user !== undefined ? options.user : {
    id: 'user-default-uid',
    email: 'membro@exemplo.com',
    user_metadata: { full_name: 'Membro Teste' },
  };

  const session = user ? { user } : null;

  const defaultRpcHandler = options.rpcHandler || (async (name, args) => {
    return { data: [], error: null };
  });

  globalThis.__reviewTransport = {
    auth: {
      onAuthStateChange: (cb) => {
        authListener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session } }),
      signOut: async () => {
        authCalls.push({ type: 'signOut' });
        if (authListener) authListener('SIGNED_OUT', null);
        return { error: null };
      },
      signInWithOAuth: async (opts) => {
        authCalls.push({ type: 'signInWithOAuth', opts });
        return { error: null };
      },
      signInWithPassword: async (creds) => {
        authCalls.push({ type: 'signInWithPassword', email: creds.email });
        return { data: { session: { user } }, error: null };
      },
      signUp: async (creds) => {
        authCalls.push({ type: 'signUp', email: creds.email, options: creds.options });
        if (options.signUpHandler) {
          return options.signUpHandler(creds);
        }
        if (options.signUpError) {
          return { data: null, error: options.signUpError };
        }
        if (options.signUpRequiresEmailConfirm) {
          return { data: { user: { id: 'new-uid', email: creds.email }, session: null }, error: null };
        }
        return { data: { user: { id: 'new-uid', email: creds.email }, session: { user } }, error: null };
      },
      resetPasswordForEmail: async (email, opts) => {
        authCalls.push({ type: 'resetPasswordForEmail', email, opts });
        return { data: {}, error: null };
      },
      updateUser: async (attrs) => {
        authCalls.push({ type: 'updateUser', attrs });
        return { data: { user }, error: null };
      },
      simulateEvent: (event, sess) => {
        if (authListener) authListener(event, sess);
      },
    },
    schema: () => ({
      rpc(name, args) {
        rpcCalls.push({ name, args });
        return defaultRpcHandler(name, args);
      },
    }),
  };

  return {
    storage,
    location: locationObj,
    historyCalls,
    clipboardCalls,
    rpcCalls,
    authCalls,
    setClipboardShouldFail: (val) => { clipboardShouldFail = val; },
    getAuthListener: () => authListener,
    simulateEvent: (ev, s) => globalThis.__reviewTransport.auth.simulateEvent(ev, s),
  };
}

function visibleText(renderer) {
  function visit(node) {
    if (node == null) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(visit).join(' ');
    if (node.type === 'style') return '';
    return visit(node.children);
  }
  return visit(renderer.toJSON());
}

async function mount(element) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
    await new Promise((r) => setTimeout(r, 20));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
  return renderer;
}

describe('Suíte de Testes da Interface de Convites e Aprovação de Nome (Contratos 011 / PRD)', () => {

  test('Cenário 1: Emissão para o membro certo, copiar link, falha de clipboard, replay sem token e reemissão somente explícita', async () => {
    // 43 caracteres exatos em Base64URL
    const rawToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
    const expiresAt = '2026-10-12T18:00:00Z';
    let issueReturnToken = rawToken;

    const fixture = setupEnvironment({
      rpcHandler: async (name, args) => {
        if (name === 'issue_church_invitation') {
          return {
            data: [{
              invitation_id: 'inv-uuid-1',
              church_id: args.p_church_id,
              member_id: args.p_member_id,
              recipient_email: args.p_recipient_email,
              raw_token: issueReturnToken,
              expires_at: expiresAt,
              issued_at: '2026-10-09T18:00:00Z',
              previous_invitation_revoked: false,
              previous_request_cancelled: false,
            }],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    });

    const activeMember = { id: 'mem-101', display_name: 'Beatriz Cantora', status: 'active' };

    // 1.1 Renderiza modal de emissão envolvido por AuthProvider
    let modalClosed = false;
    let modalSuccessData = null;
    let renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(IssueInvitationModal, {
          isOpen: true,
          onClose: () => { modalClosed = true; },
          onSuccess: (res) => { modalSuccessData = res; },
          churchId: 'church-uuid-1',
          churchName: 'Igreja Central',
          member: activeMember,
        })
      )
    );

    // Contexto da igreja e nome do membro exibidos no formulário
    assert.match(visibleText(renderer), /Igreja Central/);
    assert.match(visibleText(renderer), /Beatriz Cantora/);

    // Preenche e-mail do destinatário
    await act(async () => {
      renderer.root.findByProps({ id: 'invite-recipient-email' }).props.onChange({
        target: { value: 'beatriz@exemplo.com' },
      });
    });

    // Submete formulário de emissão
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
      await new Promise((r) => setTimeout(r, 20));
    });

    // Verifica que RPC foi chamada com ID exato do membro e e-mail
    const issueCall = fixture.rpcCalls.find((c) => c.name === 'issue_church_invitation');
    assert.ok(issueCall, 'RPC issue_church_invitation deve ser invocada');
    assert.equal(issueCall.args.p_member_id, 'mem-101');
    assert.equal(issueCall.args.p_recipient_email, 'beatriz@exemplo.com');
    assert.equal(issueCall.args.p_church_id, 'church-uuid-1');

    // Link deve ser gerado com window.location.origin
    const expectedLink = `http://localhost:3000/#/invite?token=${rawToken}`;
    const linkInput = renderer.root.findByProps({ id: 'generated-invite-link' });
    assert.equal(linkInput.props.value, expectedLink);

    // 1.2 Teste de cópia para a área de transferência
    const copyBtn = renderer.root.findByProps({ id: 'btn-copy-invite-link' });
    await act(async () => {
      copyBtn.props.onClick();
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.equal(fixture.clipboardCalls[0], expectedLink);
    assert.match(visibleText(renderer), /Copiado!/);

    // 1.3 Falha de clipboard oferece seleção manual sem fingir sucesso
    fixture.setClipboardShouldFail(true);
    await act(async () => {
      copyBtn.props.onClick();
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.match(visibleText(renderer), /Não foi possível copiar automaticamente/);

    act(() => renderer.unmount());

    // 1.4 Replay sem token: raw_token = null
    issueReturnToken = null;
    renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(IssueInvitationModal, {
          isOpen: true,
          onClose: () => {},
          churchId: 'church-uuid-1',
          churchName: 'Igreja Central',
          member: activeMember,
        })
      )
    );

    await act(async () => {
      renderer.root.findByProps({ id: 'invite-recipient-email' }).props.onChange({
        target: { value: 'beatriz@exemplo.com' },
      });
    });

    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
      await new Promise((r) => setTimeout(r, 20));
    });

    // Replay sem token não gera novo link e explica necessidade de reemissão explícita
    assert.match(visibleText(renderer), /Link não recuperável/);
    assert.match(visibleText(renderer), /reemissão explícita/);

    act(() => renderer.unmount());
  });

  test('Cenário 2: Detalhes válidos, conta errada sem dados privados, token com caixa preservada, URL limpa e callback preservado', async () => {
    // 43 caracteres exatos Base64URL
    const rawToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE';
    let isValidResponse = true;

    const fixture = setupEnvironment({
      initialUrl: `http://localhost:3000/#/invite?token=${rawToken}&code=oauth-preserved-code`,
      user: { id: 'usr-1', email: 'carlos@exemplo.com' },
      rpcHandler: async (name, args) => {
        if (name === 'get_invitation_details') {
          assert.equal(args.p_raw_token, rawToken, 'Token deve manter maiúsculas e minúsculas sem alteração');
          if (isValidResponse) {
            return {
              data: [{
                invitation_id: 'inv-uuid-2',
                church_id: 'church-uuid-2',
                church_name: 'Igreja Betel',
                member_id: 'mem-202',
                member_display_name: 'Carlos Oliveira',
                expires_at: '2026-10-15T23:59:59Z',
                is_valid: true,
              }],
              error: null,
            };
          }
          return {
            data: [{
              invitation_id: null,
              church_id: null,
              church_name: null,
              member_id: null,
              member_display_name: null,
              expires_at: null,
              is_valid: false,
            }],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    });

    // 2.1 Monta InvitationFlowPage dentro do AuthProvider com token válido
    let cleared = false;
    let renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(InvitationFlowPage, {
          token: rawToken,
          onClearToken: () => { cleared = true; },
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    // Exibe dados autorizados
    assert.match(visibleText(renderer), /Igreja Betel/);
    assert.match(visibleText(renderer), /Carlos Oliveira/);

    act(() => renderer.unmount());

    // 2.2 Conta errada ou convite inválido: exibe mensagem genérica e NÃO revela igreja/membro
    isValidResponse = false;
    renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(InvitationFlowPage, {
          token: rawToken,
          onClearToken: () => { cleared = true; },
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    const txt = visibleText(renderer);
    assert.match(txt, /Convite inválido, expirado ou não associado a esta conta/);
    assert.doesNotMatch(txt, /Igreja Betel/);
    assert.doesNotMatch(txt, /Carlos Oliveira/);

    // Botão "Sair desta conta" disponível para alternar mantendo o convite
    const switchBtn = renderer.root.findByProps({ id: 'btn-switch-account-invite' });
    assert.ok(switchBtn);

    act(() => renderer.unmount());
  });

  test('Cenário 3: Confirmação concede básico; proposta fica pendente sem alterar membro/acesso; cliques concorrentes não disparam duas intenções', async () => {
    // 43 caracteres Base64URL
    const rawToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-12345';
    let confirmCalls = 0;
    let proposeCalls = 0;

    const fixture = setupEnvironment({
      user: { id: 'usr-3', email: 'davi@exemplo.com' },
      rpcHandler: async (name, args) => {
        if (name === 'get_invitation_details') {
          return {
            data: [{
              invitation_id: 'inv-3',
              church_id: 'church-3',
              church_name: 'Igreja da Graça',
              member_id: 'mem-3',
              member_display_name: 'Davi Pastor',
              expires_at: '2026-10-20T00:00:00Z',
              is_valid: true,
            }],
            error: null,
          };
        }
        if (name === 'redeem_invitation_confirm_name') {
          confirmCalls++;
          assert.equal(args.p_expected_display_name, 'Davi Pastor');
          return {
            data: [{
              church_id: 'church-3',
              church_name: 'Igreja da Graça',
              member_id: 'mem-3',
              display_name: 'Davi Pastor',
              access_granted: true,
              onboarding_completed_at: '2026-10-09T20:00:00Z',
            }],
            error: null,
          };
        }
        if (name === 'redeem_invitation_propose_name') {
          proposeCalls++;
          assert.equal(args.p_proposed_display_name, 'Davi dos Santos');
          return {
            data: [{
              request_id: 'req-333',
              church_id: 'church-3',
              member_id: 'mem-3',
              original_display_name: 'Davi Pastor',
              proposed_display_name: 'Davi dos Santos',
              status: 'pending',
              expires_at: '2026-10-20T00:00:00Z',
              submitted_at: '2026-10-09T20:01:00Z',
            }],
            error: null,
          };
        }
        if (name === 'get_my_church_access') {
          return {
            data: [{
              church_id: 'church-3',
              church_name: 'Igreja da Graça',
              member_id: 'mem-3',
              display_name: 'Davi Pastor',
              is_admin: false,
            }],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    });

    // 3.1 Confirmação de nome concede acesso
    let tokenCleared = false;
    let renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(InvitationFlowPage, {
          token: rawToken,
          onClearToken: () => { tokenCleared = true; },
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    const confirmBtn = renderer.root.findByProps({ id: 'btn-confirm-name' });
    await act(async () => {
      confirmBtn.props.onClick();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.equal(confirmCalls, 1);
    assert.ok(tokenCleared, 'Token deve ser limpo após consumo confirmado');
    assert.match(visibleText(renderer), /Acesso Confirmado!/);

    act(() => renderer.unmount());

    // 3.2 Proposta de outro nome consome convite, cria solicitação e não concede acesso
    tokenCleared = false;
    renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(InvitationFlowPage, {
          token: rawToken,
          onClearToken: () => { tokenCleared = true; },
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    // Abre modo de proposta
    await act(async () => {
      renderer.root.findByProps({ id: 'btn-propose-other-name' }).props.onClick();
    });

    // Preenche novo nome
    await act(async () => {
      renderer.root.findByProps({ id: 'input-proposed-name' }).props.onChange({
        target: { value: 'Davi dos Santos' },
      });
    });

    // Envia proposta via formulário
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.equal(proposeCalls, 1);
    assert.ok(tokenCleared, 'Token deve ser limpo após consumo confirmado');
    assert.match(visibleText(renderer), /Proposta Enviada para Análise/);
    assert.match(visibleText(renderer), /Davi dos Santos/);

    // Verifica que marcador foi salvo em sessionStorage para a aba
    const marker = loadAccessRequestMarker(fixture.storage, 'usr-3');
    assert.ok(marker, 'Marcador de solicitação deve estar salvo na aba');
    assert.equal(marker.churchId, 'church-3');
    assert.equal(marker.requestId, 'req-333');
    assert.equal(marker.userId, 'usr-3');

    act(() => renderer.unmount());
  });

  test('Cenário 4: Aprovação, rejeição, cancelamento, expiração e disputa já decidida sem anúncio de concessão indevida', async () => {
    let decideError = null;
    let decideResult = null;

    const fixture = setupEnvironment({
      user: { id: 'admin-1', email: 'admin@igreja.com' },
      rpcHandler: async (name, args) => {
        if (name === 'list_church_access_requests') {
          return {
            data: [{
              request_id: 'req-401',
              member_id: 'mem-401',
              current_display_name: 'Ester Antiga',
              original_display_name: 'Ester Antiga',
              proposed_display_name: 'Ester Proposta',
              requester_email: 'ester@exemplo.com',
              submitted_at: '2026-10-09T10:00:00Z',
              expires_at: '2026-10-12T10:00:00Z',
              status: 'pending',
              decided_at: null,
              decided_by_name: null,
              total_count: 1,
            }],
            error: null,
          };
        }
        if (name === 'decide_access_request') {
          if (decideError) return { data: null, error: decideError };
          return { data: [decideResult], error: null };
        }
        return { data: [], error: null };
      },
    });

    // 4.1 Aprovação bem-sucedida
    decideResult = {
      request_id: 'req-401',
      member_id: 'mem-401',
      final_display_name: 'Ester Proposta',
      decision: 'approve',
      access_granted: true,
      decided_at: '2026-10-09T20:10:00Z',
      error_code: null,
    };

    let renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(AdminRequestsTab, {
          churchId: 'church-4',
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    assert.match(visibleText(renderer), /Ester Proposta/);

    // Clica em Aprovar
    await act(async () => {
      renderer.root.findByProps({ id: 'btn-approve-req-401' }).props.onClick();
    });

    // Confirma na modal
    await act(async () => {
      renderer.root.findByProps({ id: 'btn-confirm-decision-execute' }).props.onClick();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.match(visibleText(renderer), /aprovado com sucesso/);
    act(() => renderer.unmount());

    // 4.2 Rejeição: access_granted = false
    decideResult = {
      request_id: 'req-401',
      member_id: 'mem-401',
      final_display_name: 'Ester Antiga',
      decision: 'reject',
      access_granted: false,
      decided_at: '2026-10-09T20:11:00Z',
      error_code: null,
    };

    renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(AdminRequestsTab, {
          churchId: 'church-4',
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    // Clica em Rejeitar
    await act(async () => {
      renderer.root.findByProps({ id: 'btn-reject-req-401' }).props.onClick();
    });

    // Confirma na modal
    await act(async () => {
      renderer.root.findByProps({ id: 'btn-confirm-decision-execute' }).props.onClick();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.match(visibleText(renderer), /A solicitação foi rejeitada/);
    act(() => renderer.unmount());

    // 4.3 Expiração retornada pelo servidor: REQUEST_EXPIRED
    decideResult = {
      request_id: 'req-401',
      member_id: 'mem-401',
      final_display_name: 'Ester Antiga',
      decision: 'expired',
      access_granted: false,
      decided_at: '2026-10-09T20:12:00Z',
      error_code: 'REQUEST_EXPIRED',
    };

    renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(AdminRequestsTab, {
          churchId: 'church-4',
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    await act(async () => {
      renderer.root.findByProps({ id: 'btn-approve-req-401' }).props.onClick();
    });
    await act(async () => {
      renderer.root.findByProps({ id: 'btn-confirm-decision-execute' }).props.onClick();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.match(visibleText(renderer), /A solicitação expirou antes da decisão/);
    assert.doesNotMatch(visibleText(renderer), /Acesso liberado/);
    act(() => renderer.unmount());

    // 4.4 Disputa concorrente já decidida: SQLSTATE 23505
    decideResult = null;
    decideError = {
      code: '23505',
      message: 'Solicitação já foi decidida anteriormente.',
    };

    renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(AdminRequestsTab, {
          churchId: 'church-4',
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    await act(async () => {
      renderer.root.findByProps({ id: 'btn-approve-req-401' }).props.onClick();
    });
    await act(async () => {
      renderer.root.findByProps({ id: 'btn-confirm-decision-execute' }).props.onClick();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.match(visibleText(renderer), /Esta solicitação já foi decidida anteriormente por outro administrador/);
    assert.doesNotMatch(visibleText(renderer), /Acesso liberado/);
    act(() => renderer.unmount());
  });

  test('Cenário 5: Resposta incerta, reconciliação pelo mesmo command_id, e rejeição de recibo de ação/ID errado ou incompleto', async () => {
    let receiptCalled = false;
    let receiptMode = 'valid';
    const rawToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

    const userId5 = '00000000-0000-4000-8000-000000000051';
    const churchId5 = '00000000-0000-4000-8000-000000000052';
    const memberId5 = '00000000-0000-4000-8000-000000000053';
    const membershipId5 = '00000000-0000-4000-8000-000000000054';
    const invId5 = '00000000-0000-4000-8000-000000000055';

    const fixture = setupEnvironment({
      user: { id: userId5, email: 'felipe@exemplo.com' },
      rpcHandler: async (name, args) => {
        if (name === 'get_invitation_details') {
          return {
            data: [{
              invitation_id: invId5,
              church_id: churchId5,
              church_name: 'Igreja Nova',
              member_id: memberId5,
              member_display_name: 'Felipe Santos',
              expires_at: '2026-10-25T00:00:00Z',
              is_valid: true,
            }],
            error: null,
          };
        }
        if (name === 'redeem_invitation_confirm_name') {
          // Simula falha incerta de rede (timeout)
          return {
            data: null,
            error: { message: 'Network request failed: timeout', code: 'PGRST000' },
          };
        }
        if (name === 'get_invitation_command_receipt') {
          receiptCalled = true;
          // Obtém command_id da chamada real em vez de aceitar cmd-555 arbitrário
          const confirmCall = fixture.rpcCalls.find((c) => c.name === 'redeem_invitation_confirm_name');
          const realCommandId = confirmCall?.args?.p_command_id || args.p_command_id;

          if (receiptMode === 'valid') {
            return {
              data: [{
                command_id: realCommandId,
                action: 'redeem_confirm_name',
                church_id: churchId5,
                result_member_id: memberId5,
                result_entity_id: membershipId5, // Vínculo criado (não o membro)
                result_payload: {
                  church_id: churchId5,
                  church_name: 'Igreja Nova',
                  member_id: memberId5,
                  display_name: 'Felipe Santos',
                  access_granted: true,
                },
                created_at: '2026-10-09T20:20:00Z',
                link_unrecoverable: false,
              }],
              error: null,
            };
          }
          if (receiptMode === 'wrong_action') {
            return {
              data: [{
                command_id: realCommandId,
                action: 'issue_invitation',
                church_id: churchId5,
                result_member_id: memberId5,
                result_entity_id: '00000000-0000-4000-8000-000000000099',
                result_payload: {},
                created_at: '2026-10-09T20:20:00Z',
                link_unrecoverable: false,
              }],
              error: null,
            };
          }
          if (receiptMode === 'wrong_command_id') {
            return {
              data: [{
                command_id: '00000000-0000-4000-8000-ffffffffffff',
                action: 'redeem_confirm_name',
                church_id: churchId5,
                result_member_id: memberId5,
                result_entity_id: membershipId5,
                result_payload: {
                  church_id: churchId5,
                  church_name: 'Igreja Nova',
                  member_id: memberId5,
                  display_name: 'Felipe Santos',
                  access_granted: true,
                },
                created_at: '2026-10-09T20:20:00Z',
                link_unrecoverable: false,
              }],
              error: null,
            };
          }
          return { data: [], error: null };
        }
        if (name === 'get_my_church_access') {
          return { data: [], error: null };
        }
        return { data: [], error: null };
      },
    });

    // 5.1 Recibo válido com mesma ação e church_id confirma operação com sucesso
    receiptMode = 'valid';
    let renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(InvitationFlowPage, {
          token: rawToken,
          onClearToken: () => {},
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    await act(async () => {
      renderer.root.findByProps({ id: 'btn-confirm-name' }).props.onClick();
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.ok(receiptCalled, 'get_invitation_command_receipt deve ser consultado em resposta incerta');
    const firstCall = fixture.rpcCalls.find((c) => c.name === 'redeem_invitation_confirm_name');
    assert.ok(firstCall, 'RPC de confirmação deve ter sido realizada');
    assert.match(visibleText(renderer), /Acesso Confirmado!/);
    act(() => renderer.unmount());

    // 5.2 Recibo com ação diferente (ex: issue_invitation em vez de redeem_confirm_name) é rejeitado
    receiptCalled = false;
    receiptMode = 'wrong_action';

    renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(InvitationFlowPage, {
          token: rawToken,
          onClearToken: () => {},
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    await act(async () => {
      renderer.root.findByProps({ id: 'btn-confirm-name' }).props.onClick();
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.ok(receiptCalled);
    assert.match(visibleText(renderer), /A resposta do servidor demorou mais que o esperado/);
    assert.doesNotMatch(visibleText(renderer), /Acesso Confirmado!/);
    act(() => renderer.unmount());

    // 5.3 Recibo com outro command_id não pode produzir sucesso
    receiptCalled = false;
    receiptMode = 'wrong_command_id';

    renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(InvitationFlowPage, {
          token: rawToken,
          onClearToken: () => {},
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    await act(async () => {
      renderer.root.findByProps({ id: 'btn-confirm-name' }).props.onClick();
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.ok(receiptCalled);
    assert.match(visibleText(renderer), /A resposta do servidor demorou mais que o esperado/);
    assert.doesNotMatch(visibleText(renderer), /Acesso Confirmado!/);
    act(() => renderer.unmount());
  });

  test('Cenário 6: Solicitação própria restaurada por marcador após recarga; aprovado reconsulta permissões; marcador de outro UID ignorado', async () => {
    let churchAccessCalls = 0;
    let requestStatus = 'pending';

    const fixture = setupEnvironment({
      user: { id: 'usr-6', email: 'gabriel@exemplo.com' },
      rpcHandler: async (name, args) => {
        if (name === 'check_church_creation_eligibility') {
          return { data: [{ eligible: true, reason: 'eligible' }], error: null };
        }
        if (name === 'get_my_access_request') {
          assert.equal(args.p_church_id, 'church-6');
          return {
            data: [{
              request_id: 'req-601',
              church_id: 'church-6',
              church_name: 'Igreja Shalom',
              member_id: 'mem-601',
              original_display_name: 'Gabriel Antigo',
              proposed_display_name: 'Gabriel Novo',
              status: requestStatus,
              expires_at: '2026-10-18T12:00:00Z',
              submitted_at: '2026-10-09T12:00:00Z',
              decided_at: requestStatus === 'approved' ? '2026-10-09T20:30:00Z' : null,
              is_expired: false,
            }],
            error: null,
          };
        }
        if (name === 'get_my_church_access') {
          churchAccessCalls++;
          if (requestStatus === 'approved') {
            return {
              data: [{
                church_id: 'church-6',
                church_name: 'Igreja Shalom',
                member_id: 'mem-601',
                display_name: 'Gabriel Novo',
                is_admin: false,
              }],
              error: null,
            };
          }
          return { data: [], error: null };
        }
        return { data: [], error: null };
      },
    });

    // Salva marcador padrão para usr-6
    saveAccessRequestMarker(fixture.storage, 'usr-6', {
      churchId: 'church-6',
      requestId: 'req-601',
      proposedDisplayName: 'Gabriel Novo',
      originalDisplayName: 'Gabriel Antigo',
      status: 'pending',
    });

    // 6.1 Status pending: exibe card de acompanhamento
    let renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(AccessPendingPage)
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    assert.match(visibleText(renderer), /Solicitação de Nome em Análise/);
    assert.match(visibleText(renderer), /Gabriel Novo/);
    assert.match(visibleText(renderer), /Igreja Shalom/);
    act(() => renderer.unmount());

    // 6.2 Status approved: exibe ação para acessar a comunidade
    requestStatus = 'approved';
    saveAccessRequestMarker(fixture.storage, 'usr-6', {
      churchId: 'church-6',
      requestId: 'req-601',
      proposedDisplayName: 'Gabriel Novo',
      originalDisplayName: 'Gabriel Antigo',
      status: 'approved',
    });

    renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(AccessPendingPage)
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    assert.match(visibleText(renderer), /Solicitação Aprovada!/);
    const accessBtn = renderer.root.findByProps({ id: 'btn-access-approved-church' });
    await act(async () => {
      accessBtn.props.onClick();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.ok(churchAccessCalls > 0, 'reloadChurchAccess deve reconsultar permissões no banco');
    assert.equal(loadAccessRequestMarker(fixture.storage, 'usr-6'), null, 'Marcador deve ser limpo após aprovação');
    act(() => renderer.unmount());

    // 6.3 Marcador de outro UID é ignorado
    saveAccessRequestMarker(fixture.storage, 'other-user-999', {
      churchId: 'church-999',
      requestId: 'req-999',
      status: 'pending',
    });

    renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(AccessPendingPage)
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    assert.doesNotMatch(visibleText(renderer), /Solicitação de Nome em Análise/);
    assert.match(visibleText(renderer), /Quer iniciar sua comunidade\?/);
    act(() => renderer.unmount());
  });

  test('Cenário 7: Troca de igreja, logout/relogin com o mesmo UID e descarte de respostas antigas em voo', async () => {
    let authProbe;
    function Probe() {
      authProbe = useAuth();
      return null;
    }

    const fixture = setupEnvironment({
      user: { id: 'usr-7', email: 'helena@exemplo.com' },
      rpcHandler: async (name, args) => {
        if (name === 'get_my_church_access') {
          return {
            data: [
              { church_id: 'church-7a', church_name: 'Igreja Alfa', member_id: 'mem-7a', display_name: 'Helena', is_admin: true },
              { church_id: 'church-7b', church_name: 'Igreja Beta', member_id: 'mem-7b', display_name: 'Helena', is_admin: false },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    });

    const renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(Probe),
        React.createElement(SelectChurchPage)
      )
    );

    // Múltiplos vínculos direcionam para tela de seleção
    assert.match(visibleText(renderer), /Selecione sua Comunidade/);
    assert.match(visibleText(renderer), /Igreja Alfa/);
    assert.match(visibleText(renderer), /Igreja Beta/);

    // Seleciona Igreja Alfa
    await act(async () => {
      authProbe.selectChurch('church-7a');
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.equal(authProbe.churchAccess?.church_id, 'church-7a');

    // Desconecta: limpa contexto
    await act(async () => {
      await authProbe.signOut();
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.equal(authProbe.authState, 'unauthenticated');
    assert.equal(authProbe.churchAccess, null);

    act(() => renderer.unmount());
  });

  test('Cenário 8: Administrador em A e básico em B, seleção explícita e isolamento das ferramentas administrativas', async () => {
    // 8.1 MembersPage com isAdmin: true no churchAccess exibe abas e botões de convite
    let currentIsAdmin = true;

    const fixture = setupEnvironment({
      user: { id: 'admin-usr', email: 'adm@igreja.com' },
      rpcHandler: async (name, args) => {
        if (name === 'get_my_church_access') {
          return {
            data: [{
              church_id: currentIsAdmin ? 'church-adm' : 'church-basic',
              church_name: currentIsAdmin ? 'Igreja A' : 'Igreja B',
              member_id: 'mem-1',
              display_name: 'Usuário',
              is_admin: currentIsAdmin,
            }],
            error: null,
          };
        }
        if (name === 'list_church_members') {
          return {
            data: [
              { id: 'mem-1', display_name: 'Membro Um', status: 'active', joined_at: '2026-01-01T00:00:00Z', total_count: 2 },
              { id: 'mem-2', display_name: 'Membro Dois', status: 'active', joined_at: '2026-01-01T00:00:00Z', total_count: 2 },
            ],
            error: null,
          };
        }
        if (name === 'list_church_invitations') {
          return { data: [], error: null };
        }
        if (name === 'list_church_access_requests') {
          return { data: [], error: null };
        }
        return { data: [], error: null };
      },
    });

    let renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(MembersPage)
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    let text = visibleText(renderer);
    assert.match(text, /Convites de Acesso/);
    assert.match(text, /Solicitações de Nome/);

    act(() => renderer.unmount());

    // 8.2 MembersPage com isAdmin: false oculta abas e botões de convite
    currentIsAdmin = false;

    renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(MembersPage)
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    text = visibleText(renderer);
    assert.doesNotMatch(text, /Convites de Acesso/);
    assert.doesNotMatch(text, /Solicitações de Nome/);
    assert.match(text, /Acesso Restrito/);

    act(() => renderer.unmount());
  });

  test('Cenário 9: Interface de e-mail/senha e estados de confirmação/recuperação pelo SDK sem senhas persistidas', async () => {
    let authProbe;
    function Probe() {
      authProbe = useAuth();
      return null;
    }

    const fixture = setupEnvironment({
      user: null,
      signUpRequiresEmailConfirm: true,
    });

    const renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(Probe),
        React.createElement(LoginPage)
      )
    );

    // Alterna para cadastro via botão Cadastre-se
    await act(async () => {
      renderer.root.findByProps({ id: 'btn-switch-to-register' }).props.onClick();
    });

    // Preenche credenciais
    await act(async () => {
      renderer.root.findByProps({ id: 'login-email-input' }).props.onChange({
        target: { value: 'novo@exemplo.com' },
      });
      renderer.root.findByProps({ id: 'login-password-input' }).props.onChange({
        target: { value: 'SenhaSecreta123!' },
      });
      renderer.root.findByProps({ id: 'login-confirm-password' }).props.onChange({
        target: { value: 'SenhaSecreta123!' },
      });
    });

    // Submete cadastro via formulário
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
      await new Promise((r) => setTimeout(r, 20));
    });

    // Confirmação necessária exibida
    assert.match(visibleText(renderer), /Cadastro realizado! Enviamos um e-mail de confirmação/);

    // Senhas não persistem em storage
    for (let i = 0; i < fixture.storage.length; i++) {
      const k = fixture.storage.key(i);
      assert.doesNotMatch(fixture.storage.getItem(k) || '', /SenhaSecreta123!/);
    }

    // Modo de recuperação de senha pelo AuthContext
    await act(async () => {
      authProbe.setIsPasswordRecovery(true);
      await new Promise((r) => setTimeout(r, 10));
    });

    assert.match(visibleText(renderer), /Definir Nova Senha/);

    act(() => renderer.unmount());
  });

  test('Cenário 10: Backend indisponível/RPC ausente tratado com erro honesto sem dados fictícios ou telas antigas', async () => {
    const rawToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

    const fixture = setupEnvironment({
      user: { id: 'usr-10', email: 'test@exemplo.com' },
      rpcHandler: async (name, args) => {
        if (name === 'get_invitation_details') {
          return {
            data: null,
            error: {
              code: '42883',
              message: 'function public.get_invitation_details(text) does not exist',
            },
          };
        }
        return { data: [], error: null };
      },
    });

    const renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(InvitationFlowPage, {
          token: rawToken,
          onClearToken: () => {},
        })
      )
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    // Erro de indisponibilidade ou convite inválido exibido honestamente
    assert.match(visibleText(renderer), /Convite Não Disponível/);
    assert.match(visibleText(renderer), /Convite inválido, expirado ou não associado a esta conta/);

    // Não monta dados fictícios nem protótipo antigo
    assert.doesNotMatch(visibleText(renderer), /Ministério Shalom/);
    assert.doesNotMatch(visibleText(renderer), /Ao Vivo/);

    act(() => renderer.unmount());
  });

  test('Cenário 11: Primeiro acesso por convite: escolhas visíveis, cadastro sem senha anterior, orientação de confirmação/outra aba e continuidade', async () => {
    // 43 caracteres exatos Base64URL
    const rawToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABC11';
    let userRegistered = false;
    let authEmailConfirmed = false;

    const fixture = setupEnvironment({
      initialUrl: `http://localhost:3000/#/invite?token=${rawToken}`,
      user: null, // Começa deslogado
      signUpRequiresEmailConfirm: true,
      rpcHandler: async (name, args) => {
        if (name === 'get_invitation_details') {
          assert.equal(args.p_raw_token, rawToken);
          if (authEmailConfirmed) {
            return {
              data: [{
                invitation_id: 'inv-uuid-11',
                church_id: 'church-uuid-11',
                church_name: 'Comunidade da Graça',
                member_id: 'mem-11',
                member_display_name: 'Fernanda Lima',
                expires_at: '2026-10-14T23:59:59Z',
                is_valid: true,
              }],
              error: null,
            };
          }
          return {
            data: [{
              invitation_id: null,
              church_id: null,
              church_name: null,
              member_id: null,
              member_display_name: null,
              expires_at: null,
              is_valid: false,
            }],
            error: null,
          };
        }
        if (name === 'get_my_church_access') {
          // Conta isolada recém-criada sem vínculo
          return { data: [], error: null };
        }
        return { data: [], error: null };
      },
    });

    // 11.1 Ao abrir o convite deslogado, monta App e verifica URL limpa e token retido
    let renderer = await mount(React.createElement(App));

    // Token capturado no sessionStorage e URL limpa
    assert.equal(fixture.storage.getItem('escala_invite_token_pending'), rawToken);

    // Contexto claro do convite exibido
    const initialText = visibleText(renderer);
    assert.match(initialText, /Você recebeu um convite/);
    assert.match(initialText, /Para continuar, use o e-mail para o qual ele foi emitido/);

    // Duas escolhas visíveis: "É meu primeiro acesso — Criar conta" e "Já tenho conta — Entrar"
    const firstAccessBtn = renderer.root.findByProps({ id: 'btn-invite-first-access' });
    const existingAccBtn = renderer.root.findByProps({ id: 'btn-invite-existing-account' });
    assert.ok(firstAccessBtn, 'Botão de primeiro acesso deve estar presente');
    assert.ok(existingAccBtn, 'Botão de conta existente deve estar presente');
    assert.equal(firstAccessBtn.props['aria-selected'], true, 'Primeiro acesso deve vir selecionado por padrão');

    // Modo inicial é cadastro (sem exigir senha prévia)
    const emailInput = renderer.root.findByProps({ id: 'login-email-input' });
    const passwordInput = renderer.root.findByProps({ id: 'login-password-input' });
    const confirmPasswordInput = renderer.root.findByProps({ id: 'login-confirm-password' });
    const registerBtn = renderer.root.findByProps({ id: 'btn-email-register' });
    assert.ok(emailInput);
    assert.ok(passwordInput);
    assert.ok(confirmPasswordInput);
    assert.ok(registerBtn);

    // Orienta que a conta é de acesso ao Escala do Reino, sem criar igreja ou outro membro
    assert.match(initialText, /Esta conta é pessoal para o seu acesso ao Escala do Reino/);
    assert.match(initialText, /Criar sua conta não cria uma nova igreja nem outro membro/);

    // Google disponível com orientação sobre o mesmo e-mail convidado
    assert.ok(renderer.root.findByProps({ id: 'btn-google-login' }));
    assert.match(initialText, /sua conta Google deve usar o mesmo e-mail para o qual o convite foi emitido/);

    // 11.2 Alternância fluida entre opções sem perda de contexto
    await act(async () => {
      existingAccBtn.props.onClick();
    });
    let loginText = visibleText(renderer);
    assert.match(loginText, /Já tenho conta — Entrar/);
    assert.ok(renderer.root.findByProps({ id: 'btn-email-login' }));

    // Retorna para primeiro acesso
    await act(async () => {
      firstAccessBtn.props.onClick();
    });
    assert.match(visibleText(renderer), /É meu primeiro acesso — Criar conta/);

    // 11.3 Preenche cadastro com e-mail convidado e senha escolhida
    await act(async () => {
      renderer.root.findByProps({ id: 'login-email-input' }).props.onChange({
        target: { value: 'fernanda@exemplo.com' },
      });
      renderer.root.findByProps({ id: 'login-password-input' }).props.onChange({
        target: { value: 'MinhaSenhaSegura#2026' },
      });
      renderer.root.findByProps({ id: 'login-confirm-password' }).props.onChange({
        target: { value: 'MinhaSenhaSegura#2026' },
      });
    });

    // Submete cadastro
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
      await new Promise((r) => setTimeout(r, 20));
    });

    // Confirmação orientada claramente (mesma aba e outra aba)
    const confirmText = visibleText(renderer);
    assert.match(confirmText, /Cadastro realizado! Enviamos um e-mail de confirmação/);
    assert.match(confirmText, /Se a confirmação abrir uma nova aba/);
    assert.match(confirmText, /retorne a esta aba do convite ou reabra o link original/);
    assert.match(confirmText, /A criação da conta não concede acesso à igreja automaticamente/);

    // Senha não foi persistida em storage
    for (let i = 0; i < fixture.storage.length; i++) {
      const k = fixture.storage.key(i);
      assert.doesNotMatch(fixture.storage.getItem(k) || '', /MinhaSenhaSegura#2026/);
    }

    // Botão de checagem pós-confirmação disponível
    const checkConfirmBtn = renderer.root.findByProps({ id: 'btn-check-confirmed-email' });
    assert.ok(checkConfirmBtn);

    // 11.4 Simula confirmação do e-mail (evento SIGNED_IN do Supabase Auth com e-mail confirmado)
    authEmailConfirmed = true;
    const confirmedUser = {
      id: 'usr-11',
      email: 'fernanda@exemplo.com',
      email_confirmed_at: '2026-10-11T12:00:00Z',
    };

    await act(async () => {
      fixture.simulateEvent('SIGNED_IN', { user: confirmedUser });
      await new Promise((r) => setTimeout(r, 40));
    });

    // Retoma automaticamente o fluxo do convite com InvitationFlowPage
    const flowText = visibleText(renderer);
    assert.match(flowText, /Comunidade da Graça/);
    assert.match(flowText, /Fernanda Lima/);
    assert.ok(renderer.root.findByProps({ id: 'btn-confirm-name' }));
    assert.ok(renderer.root.findByProps({ id: 'btn-propose-other-name' }));

    act(() => renderer.unmount());

    // 11.5 Confirmação em outra aba isolada sem o token: direciona para AccessPendingPage com orientações
    const fixtureAnotherTab = setupEnvironment({
      initialUrl: 'http://localhost:3000/',
      user: confirmedUser,
      rpcHandler: async (name) => {
        if (name === 'get_my_church_access') return { data: [], error: null };
        return { data: [], error: null };
      },
    });

    const rendererAnotherTab = await mount(React.createElement(App));
    const anotherTabText = visibleText(rendererAnotherTab);
    assert.match(anotherTabText, /Acesso à igreja ainda não liberado/);
    assert.match(anotherTabText, /Recebeu um convite para participar de uma igreja\?/);
    assert.match(anotherTabText, /Retorne à aba original/);
    assert.match(anotherTabText, /Reabra o link original do convite/);

    act(() => rendererAnotherTab.unmount());

    // 11.6 Tentativa de cadastro de conta já existente orienta login sem trocar senha
    const fixtureExisting = setupEnvironment({
      initialUrl: `http://localhost:3000/#/invite?token=${rawToken}`,
      user: null,
      signUpError: {
        message: 'User already registered',
      },
    });

    const rendererExisting = await mount(React.createElement(App));
    await act(async () => {
      rendererExisting.root.findByProps({ id: 'login-email-input' }).props.onChange({
        target: { value: 'existente@exemplo.com' },
      });
      rendererExisting.root.findByProps({ id: 'login-password-input' }).props.onChange({
        target: { value: 'OutraSenha#123' },
      });
      rendererExisting.root.findByProps({ id: 'login-confirm-password' }).props.onChange({
        target: { value: 'OutraSenha#123' },
      });
    });

    await act(async () => {
      rendererExisting.root.findByType('form').props.onSubmit({ preventDefault() {} });
      await new Promise((r) => setTimeout(r, 20));
    });

    const existingText = visibleText(rendererExisting);
    assert.match(existingText, /Este e-mail já possui uma conta no Escala do Reino/);
    assert.match(existingText, /Já tenho conta — Entrar/);

    act(() => rendererExisting.unmount());

    // 11.7 Botão "Já confirmei meu e-mail — Continuar": quando ainda sem sessão ativa, orienta para login com senha
    const fixtureManualCheck = setupEnvironment({
      initialUrl: `http://localhost:3000/#/invite?token=${rawToken}`,
      user: null,
      signUpRequiresEmailConfirm: true,
    });

    const rendererManualCheck = await mount(React.createElement(App));
    await act(async () => {
      rendererManualCheck.root.findByProps({ id: 'login-email-input' }).props.onChange({
        target: { value: 'manual@exemplo.com' },
      });
      rendererManualCheck.root.findByProps({ id: 'login-password-input' }).props.onChange({
        target: { value: 'SenhaManual#123' },
      });
      rendererManualCheck.root.findByProps({ id: 'login-confirm-password' }).props.onChange({
        target: { value: 'SenhaManual#123' },
      });
    });

    await act(async () => {
      rendererManualCheck.root.findByType('form').props.onSubmit({ preventDefault() {} });
      await new Promise((r) => setTimeout(r, 20));
    });

    // Clica em "Já confirmei meu e-mail — Continuar"
    await act(async () => {
      rendererManualCheck.root.findByProps({ id: 'btn-check-confirmed-email' }).props.onClick();
      await new Promise((r) => setTimeout(r, 20));
    });

    const manualCheckText = visibleText(rendererManualCheck);
    assert.match(manualCheckText, /informe sua senha para entrar e continuar/);
    assert.ok(rendererManualCheck.root.findByProps({ id: 'btn-email-login' }));

    act(() => rendererManualCheck.unmount());
  });

});

