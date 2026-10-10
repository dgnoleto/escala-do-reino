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
const bundlePath = path.join(cacheDir, 'review-contrato.bundle.mjs');

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
        savePendingInvitationCommand,
        loadPendingInvitationCommand,
        removePendingInvitationCommand,
        checkPendingOperationConflict,
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
  savePendingInvitationCommand,
  loadPendingInvitationCommand,
  removePendingInvitationCommand,
  checkPendingOperationConflict,
} = await import(pathToFileURL(bundlePath).href);

// Carrega o manifesto de ações e valida estritamente os parâmetros das 9 RPCs
const manifestPath = path.resolve(process.cwd(), 'docs', 'sql', 'src_011', '00_actions_manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const rpcAllowedParams = new Map(manifest.rpcs.map((r) => [r.name, new Set(r.parameters.map((p) => p.name))]));

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
        // Validação estrita dos parâmetros contra o manifesto SQL real
        if (rpcAllowedParams.has(name)) {
          const allowed = rpcAllowedParams.get(name);
          const invalid = Object.keys(args || {}).filter((k) => !allowed.has(k));
          if (invalid.length > 0) {
            throw new Error(`Parametro inexistente em ${name}: ${invalid.join(', ')}`);
          }
        }
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

const uid = '00000000-0000-4000-8000-000000000001';
const churchId = '00000000-0000-4000-8000-000000000002';
const memberId = '00000000-0000-4000-8000-000000000003';
const otherMemberId = '00000000-0000-4000-8000-000000000004';
const requestId = '00000000-0000-4000-8000-000000000005';
const otherRequestId = '00000000-0000-4000-8000-000000000006';
const token43 = 'Ab'.repeat(21) + 'C';
const user = { id: uid, email: 'pessoa@example.invalid' };
const empty = () => ({ data: [], error: null });
const timeout = { data: null, error: { code: 'PGRST000', message: 'Network timeout' } };
const pause = () => new Promise((r) => setTimeout(r, 30));
const member = { member_id: memberId, display_name: 'Pessoa', status: 'active' };
const pending = {
  request_id: requestId,
  member_id: memberId,
  current_display_name: 'Pessoa',
  original_display_name: 'Pessoa',
  proposed_display_name: 'Pessoa Nova',
  requester_email: user.email,
  status: 'pending',
  expires_at: '2026-10-13T23:00:00Z',
  submitted_at: '2026-10-10T23:00:00Z',
  total_count: 1,
};
const details = {
  invitation_id: '00000000-0000-4000-8000-000000000010',
  church_id: churchId,
  church_name: 'Igreja',
  member_id: memberId,
  member_display_name: 'Pessoa',
  is_valid: true,
  expires_at: '2026-10-13T23:00:00Z',
};

// ============================================================================
// BLOCOS D1, D2, D3 DE CONTRATO (REPRODUÇÃO EXATA DA REVISÃO CODEX)
// ============================================================================

test('D1: deteccao de reemissao deve usar parametros das RPCs reais', async (t) => {
  const env = setupEnvironment({ user });
  const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(IssueInvitationModal, {
    churchId,
    churchName: 'Igreja',
    member,
    isOpen: true,
    onClose() {},
  })));
  t.after(() => act(() => renderer.unmount()));

  for (const name of ['list_church_invitations', 'list_church_access_requests']) {
    const call = env.rpcCalls.find((c) => c.name === name);
    assert.ok(call, `Chamada não encontrada para ${name}`);
    const allowed = new Set(manifest.rpcs.find((r) => r.name === name).parameters.map((p) => p.name));
    assert.ok(
      Object.keys(call.args).every((k) => allowed.has(k)),
      'Parametro inexistente em ' + name + ': ' + Object.keys(call.args).filter((k) => !allowed.has(k)).join(', ')
    );
  }
});

test('D2: aprovacao incerta nao pode ser substituida por rejeicao', async (t) => {
  const env = setupEnvironment({
    user,
    rpcHandler: async (name) => {
      if (name === 'list_church_access_requests') return { data: [pending], error: null };
      if (name === 'decide_access_request') return timeout;
      return empty();
    },
  });
  const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(AdminRequestsTab, { churchId })));
  t.after(() => act(() => renderer.unmount()));

  await act(async () => renderer.root.findByProps({ id: 'btn-approve-' + requestId }).props.onClick());
  await act(async () => {
    renderer.root.findByProps({ id: 'btn-confirm-decision-execute' }).props.onClick();
    await pause();
  });

  const savedKey = 'escala_invitation_cmd_' + uid + '_decide_access_request';
  const originalSaved = env.storage.getItem(savedKey);
  assert.ok(originalSaved);

  const cancel = renderer.root.findAll((n) => n.type === 'button' && n.props.children === 'Cancelar')[0];
  if (cancel && !cancel.props.disabled) await act(async () => cancel.props.onClick());

  const reject = renderer.root.findAllByProps({ id: 'btn-reject-' + requestId })[0];
  if (reject && !reject.props.disabled) {
    await act(async () => reject.props.onClick());
    const confirm = renderer.root.findAllByProps({ id: 'btn-confirm-decision-execute' })[0];
    if (confirm && !confirm.props.disabled) {
      await act(async () => {
        confirm.props.onClick();
        await pause();
      });
    }
  }

  assert.equal(
    env.rpcCalls.filter((c) => c.name === 'decide_access_request' && c.args.p_decision === 'reject').length,
    0,
    'Nova rejeicao foi enviada enquanto a aprovacao permanecia desconhecida'
  );
  assert.equal(env.storage.getItem(savedKey), originalSaved);
});

test('D3: pendencia de emissao de outro membro nao pode ser sobrescrita', async (t) => {
  const env = setupEnvironment({
    user,
    rpcHandler: async (name) => (name === 'issue_church_invitation' ? timeout : empty()),
  });
  const element = (m) => React.createElement(AuthProvider, null, React.createElement(IssueInvitationModal, {
    churchId,
    churchName: 'Igreja',
    member: m,
    isOpen: true,
    onClose() {},
  }));

  let renderer = await mount(element(member));
  const submit = async () => {
    await act(async () => renderer.root.findByProps({ id: 'invite-recipient-email' }).props.onChange({ target: { value: user.email } }));
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
      await pause();
    });
  };

  await submit();
  const key = 'escala_invitation_cmd_' + uid + '_issue_invitation';
  const firstCommand = JSON.parse(env.storage.getItem(key));
  assert.equal(firstCommand.memberId, memberId);

  act(() => renderer.unmount());
  renderer = await mount(element({ ...member, member_id: otherMemberId, display_name: 'Outra Pessoa' }));
  t.after(() => act(() => renderer.unmount()));

  const input = renderer.root.findAllByProps({ id: 'invite-recipient-email' })[0];
  if (input && !input.props.disabled) await submit();

  const storedCommands = Array.from({ length: env.storage.length }, (_, i) => env.storage.getItem(env.storage.key(i)));
  assert.ok(
    storedCommands.some((raw) => raw && raw.includes(firstCommand.commandId)),
    'Comando desconhecido do primeiro membro foi sobrescrito ao emitir para outro'
  );
});

// ============================================================================
// EXTENSÕES OBRIGATÓRIAS DO CONTRATO: DETECÇÃO, ERROS E AS 4 AÇÕES
// ============================================================================

test('D1-erro: falha na consulta de reemissao nao autoriza envio sem confirmacao', async (t) => {
  const env = setupEnvironment({
    user,
    rpcHandler: async (name) => {
      if (name === 'list_church_invitations' || name === 'list_church_access_requests') {
        return { data: null, error: { message: 'Erro de conexao ao consultar' } };
      }
      return empty();
    },
  });

  const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(IssueInvitationModal, {
    churchId,
    churchName: 'Igreja',
    member,
    isOpen: true,
    onClose() {},
  })));
  t.after(() => act(() => renderer.unmount()));

  await act(async () => renderer.root.findByProps({ id: 'invite-recipient-email' }).props.onChange({ target: { value: 'alvo@exemplo.com' } }));
  // Tentativa de envio sem marcar o checkbox de confirmação
  await act(async () => {
    renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
    await pause();
  });

  assert.equal(env.rpcCalls.filter((c) => c.name === 'issue_church_invitation').length, 0, 'Emissao executada sem confirmacao em estado incerto de deteccao');
  assert.match(visibleText(renderer), /necessário confirmar|ciente da substituição/i, 'Mensagem de confirmacao obrigatoria nao foi exibida');
});

test('D1-incompleto: primeira pagina com contagem total excedente exige confirmacao', async (t) => {
  const env = setupEnvironment({
    user,
    rpcHandler: async (name) => {
      if (name === 'list_church_invitations') {
        // Retorna página 1 sem o membro, mas total_count indica que há mais na página 2
        return {
          data: [{ invitation_id: '00000000-0000-4000-8000-000000000099', member_id: otherMemberId, total_count: 55 }],
          error: null,
        };
      }
      return empty();
    },
  });

  const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(IssueInvitationModal, {
    churchId,
    churchName: 'Igreja',
    member,
    isOpen: true,
    onClose() {},
  })));
  t.after(() => act(() => renderer.unmount()));

  await act(async () => renderer.root.findByProps({ id: 'invite-recipient-email' }).props.onChange({ target: { value: 'alvo@exemplo.com' } }));
  await act(async () => {
    renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
    await pause();
  });

  assert.equal(env.rpcCalls.filter((c) => c.name === 'issue_church_invitation').length, 0, 'Consulta incompleta permitiu envio sem confirmacao');
});

test('D2-simetrico: rejeicao incerta nao pode ser substituida por aprovacao', async (t) => {
  const env = setupEnvironment({
    user,
    rpcHandler: async (name) => {
      if (name === 'list_church_access_requests') return { data: [pending], error: null };
      if (name === 'decide_access_request') return timeout;
      return empty();
    },
  });
  const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(AdminRequestsTab, { churchId })));
  t.after(() => act(() => renderer.unmount()));

  // Clica primeiro em Rejeitar e confirma
  await act(async () => renderer.root.findByProps({ id: 'btn-reject-' + requestId }).props.onClick());
  await act(async () => {
    renderer.root.findByProps({ id: 'btn-confirm-decision-execute' }).props.onClick();
    await pause();
  });

  const savedKey = 'escala_invitation_cmd_' + uid + '_decide_access_request';
  const originalSaved = env.storage.getItem(savedKey);
  assert.ok(originalSaved);
  assert.equal(JSON.parse(originalSaved).decision, 'reject');

  // Fecha modal e tenta Aprovar a mesma solicitação
  const cancel = renderer.root.findAll((n) => n.type === 'button' && n.props.children === 'Cancelar')[0];
  if (cancel && !cancel.props.disabled) await act(async () => cancel.props.onClick());

  const approve = renderer.root.findAllByProps({ id: 'btn-approve-' + requestId })[0];
  if (approve && !approve.props.disabled) {
    await act(async () => approve.props.onClick());
    const confirm = renderer.root.findAllByProps({ id: 'btn-confirm-decision-execute' })[0];
    if (confirm && !confirm.props.disabled) {
      await act(async () => {
        confirm.props.onClick();
        await pause();
      });
    }
  }

  assert.equal(
    env.rpcCalls.filter((c) => c.name === 'decide_access_request' && c.args.p_decision === 'approve').length,
    0,
    'Nova aprovacao foi enviada enquanto a rejeicao permanecia desconhecida'
  );
  assert.equal(env.storage.getItem(savedKey), originalSaved);
});

test('OP-repetir: nas 4 acoes, repetir operacao incerta preserva estritamente o mesmo command_id', async (t) => {
  const env = setupEnvironment({
    user,
    rpcHandler: async () => timeout,
  });

  // 1. issue_invitation
  let r1 = await mount(React.createElement(AuthProvider, null, React.createElement(IssueInvitationModal, {
    churchId,
    churchName: 'Igreja',
    member,
    isOpen: true,
    onClose() {},
  })));
  await act(async () => r1.root.findByProps({ id: 'invite-recipient-email' }).props.onChange({ target: { value: 'alvo@exemplo.com' } }));
  const checkbox1 = r1.root.findAllByProps({ type: 'checkbox' })[0];
  if (checkbox1) await act(async () => checkbox1.props.onChange({ target: { checked: true } }));
  await act(async () => { r1.root.findByType('form').props.onSubmit({ preventDefault() {} }); await pause(); });
  await act(async () => { r1.root.findByType('form').props.onSubmit({ preventDefault() {} }); await pause(); });
  const issueCalls = env.rpcCalls.filter((c) => c.name === 'issue_church_invitation');
  assert.equal(issueCalls.length, 2);
  assert.equal(issueCalls[0].args.p_command_id, issueCalls[1].args.p_command_id, 'issue_invitation alterou command_id ao repetir');
  act(() => r1.unmount());

  // 2. redeem_confirm_name
  env.rpcCalls.length = 0;
  globalThis.__reviewTransport.schema = () => ({
    rpc(name, args) {
      env.rpcCalls.push({ name, args });
      if (name === 'get_invitation_details') return Promise.resolve({ data: [details], error: null });
      return Promise.resolve(timeout);
    },
  });
  let r2 = await mount(React.createElement(AuthProvider, null, React.createElement(InvitationFlowPage, {
    token: token43,
    onClearToken() {},
  })));
  await act(async () => { r2.root.findByProps({ id: 'btn-confirm-name' }).props.onClick(); await pause(); await pause(); });
  await act(async () => { r2.root.findByProps({ id: 'btn-confirm-name' }).props.onClick(); await pause(); await pause(); });
  const confirmCalls = env.rpcCalls.filter((c) => c.name === 'redeem_invitation_confirm_name');
  assert.equal(confirmCalls.length, 2);
  assert.equal(confirmCalls[0].args.p_command_id, confirmCalls[1].args.p_command_id, 'redeem_confirm_name alterou command_id ao repetir');
  act(() => r2.unmount());

  // 3. decide_access_request
  env.rpcCalls.length = 0;
  globalThis.__reviewTransport.schema = () => ({
    rpc(name, args) {
      env.rpcCalls.push({ name, args });
      if (name === 'list_church_access_requests') return Promise.resolve({ data: [pending], error: null });
      return Promise.resolve(timeout);
    },
  });
  let r3 = await mount(React.createElement(AuthProvider, null, React.createElement(AdminRequestsTab, { churchId })));
  await act(async () => r3.root.findByProps({ id: 'btn-approve-' + requestId }).props.onClick());
  await act(async () => { r3.root.findByProps({ id: 'btn-confirm-decision-execute' }).props.onClick(); await pause(); await pause(); });
  await act(async () => { r3.root.findByProps({ id: 'btn-confirm-decision-execute' }).props.onClick(); await pause(); await pause(); });
  const decideCalls = env.rpcCalls.filter((c) => c.name === 'decide_access_request');
  assert.equal(decideCalls.length, 2);
  assert.equal(decideCalls[0].args.p_command_id, decideCalls[1].args.p_command_id, 'decide_access_request alterou command_id ao repetir');
  act(() => r3.unmount());

  // 4. redeem_propose_name
  env.rpcCalls.length = 0;
  removePendingInvitationCommand(env.storage, uid, 'redeem_confirm_name');
  globalThis.__reviewTransport.schema = () => ({
    rpc(name, args) {
      env.rpcCalls.push({ name, args });
      if (name === 'get_invitation_details') return Promise.resolve({ data: [details], error: null });
      return Promise.resolve(timeout);
    },
  });
  let r4 = await mount(React.createElement(AuthProvider, null, React.createElement(InvitationFlowPage, {
    token: token43,
    onClearToken() {},
  })));
  await act(async () => { r4.root.findByProps({ id: 'btn-propose-other-name' }).props.onClick(); await pause(); });
  await act(async () => { r4.root.findByProps({ id: 'input-proposed-name' }).props.onChange({ target: { value: 'Pessoa Nova' } }); });
  await act(async () => { r4.root.findByType('form').props.onSubmit({ preventDefault() {} }); await pause(); await pause(); });
  await act(async () => { r4.root.findByType('form').props.onSubmit({ preventDefault() {} }); await pause(); await pause(); });
  const proposeCalls = env.rpcCalls.filter((c) => c.name === 'redeem_invitation_propose_name');
  assert.equal(proposeCalls.length, 2);
  assert.equal(proposeCalls[0].args.p_command_id, proposeCalls[1].args.p_command_id, 'redeem_propose_name alterou command_id ao repetir');
  act(() => r4.unmount());
});

test('OP-respostas-velhas: recibo de outro command_id ou usuario nao confirma operacao ativa', async (t) => {
  const env = setupEnvironment({
    user,
    rpcHandler: async (name, args) => {
      if (name === 'list_church_access_requests') return { data: [pending], error: null };
      if (name === 'decide_access_request') return timeout;
      // Retorna recibo para outro command_id
      if (name === 'get_invitation_command_receipt') {
        return {
          data: [{
            command_id: '00000000-0000-4000-8000-999999999999',
            action: 'decide_access_request',
            church_id: churchId,
            result_member_id: memberId,
            result_entity_id: requestId,
            result_payload: { request_id: requestId, member_id: memberId, final_display_name: 'Pessoa Nova', decision: 'approved', access_granted: true },
            created_at: '2026-10-10T23:01:00Z',
            link_unrecoverable: false,
          }],
          error: null,
        };
      }
      return empty();
    },
  });

  const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(AdminRequestsTab, { churchId })));
  t.after(() => act(() => renderer.unmount()));

  await act(async () => renderer.root.findByProps({ id: 'btn-approve-' + requestId }).props.onClick());
  await act(async () => {
    renderer.root.findByProps({ id: 'btn-confirm-decision-execute' }).props.onClick();
    await pause();
  });

  assert.doesNotMatch(visibleText(renderer), /aprovado com sucesso/i, 'Recibo com command_id incorreto confirmou a decisao');
});

test('OP-trocar: trocar acao, parametros ou alvo nao substitui uma operacao desconhecida', async (t) => {
  const env = setupEnvironment({
    user,
    rpcHandler: async (name) => {
      if (name === 'list_church_access_requests') return { data: [pending], error: null };
      if (name === 'get_invitation_details') return { data: [details], error: null };
      return timeout;
    },
  });

  // 1. Resgate: tentar trocar acao de confirm para propose enquanto confirm esta desconhecido
  let rFlow = await mount(React.createElement(AuthProvider, null, React.createElement(InvitationFlowPage, {
    token: token43,
    onClearToken() {},
  })));
  await act(async () => { rFlow.root.findByProps({ id: 'btn-confirm-name' }).props.onClick(); await pause(); });
  assert.equal(env.rpcCalls.filter((c) => c.name === 'redeem_invitation_confirm_name').length, 1);

  // Botao de propor outro nome deve estar desabilitado ou no-op
  const proposeBtn = rFlow.root.findByProps({ id: 'btn-propose-other-name' });
  assert.ok(proposeBtn.props.disabled, 'Botao de propor outro nome deve estar desabilitado enquanto confirm esta incerto');
  act(() => rFlow.unmount());

  // 2. Emissao: tentar trocar alvo para outro membro enquanto membro anterior esta desconhecido
  env.rpcCalls.length = 0;
  let rModalA = await mount(React.createElement(AuthProvider, null, React.createElement(IssueInvitationModal, {
    churchId,
    churchName: 'Igreja',
    member,
    isOpen: true,
    onClose() {},
  })));
  await act(async () => rModalA.root.findByProps({ id: 'invite-recipient-email' }).props.onChange({ target: { value: 'membro_a@exemplo.com' } }));
  const chkA = rModalA.root.findAllByProps({ type: 'checkbox' })[0];
  if (chkA) await act(async () => chkA.props.onChange({ target: { checked: true } }));
  await act(async () => { rModalA.root.findByType('form').props.onSubmit({ preventDefault() {} }); await pause(); });
  assert.equal(env.rpcCalls.filter((c) => c.name === 'issue_church_invitation').length, 1);
  act(() => rModalA.unmount());

  // Abre membro B
  const otherMember = { id: '00000000-0000-4000-8000-000000000004', full_name: 'Membro B' };
  let rModalB = await mount(React.createElement(AuthProvider, null, React.createElement(IssueInvitationModal, {
    churchId,
    churchName: 'Igreja',
    member: otherMember,
    isOpen: true,
    onClose() {},
  })));
  const emailB = rModalB.root.findByProps({ id: 'invite-recipient-email' });
  assert.ok(emailB.props.disabled, 'Input de email de membro B deve estar desabilitado enquanto membro A esta desconhecido');
  act(() => rModalB.unmount());
});

test('OP-remontar: remontar componentes retoma a operacao desconhecida do storage', async (t) => {
  const env = setupEnvironment({
    user,
    rpcHandler: async (name) => {
      if (name === 'list_church_access_requests') return { data: [pending], error: null };
      if (name === 'get_invitation_details') return { data: [details], error: null };
      return timeout;
    },
  });

  // 1. IssueInvitationModal: envia -> timeout -> fecha/desmonta -> remonta -> repete -> preserva command_id
  let rModal1 = await mount(React.createElement(AuthProvider, null, React.createElement(IssueInvitationModal, {
    churchId,
    churchName: 'Igreja',
    member,
    isOpen: true,
    onClose() {},
  })));
  await act(async () => rModal1.root.findByProps({ id: 'invite-recipient-email' }).props.onChange({ target: { value: 'remount@exemplo.com' } }));
  const chk1 = rModal1.root.findAllByProps({ type: 'checkbox' })[0];
  if (chk1) await act(async () => chk1.props.onChange({ target: { checked: true } }));
  await act(async () => { rModal1.root.findByType('form').props.onSubmit({ preventDefault() {} }); await pause(); });
  const firstIssueId = env.rpcCalls.find((c) => c.name === 'issue_church_invitation').args.p_command_id;
  act(() => rModal1.unmount());

  // Remonta IssueInvitationModal para o mesmo membro
  let rModal2 = await mount(React.createElement(AuthProvider, null, React.createElement(IssueInvitationModal, {
    churchId,
    churchName: 'Igreja',
    member,
    isOpen: true,
    onClose() {},
  })));
  const chk2 = rModal2.root.findAllByProps({ type: 'checkbox' })[0];
  if (chk2) await act(async () => chk2.props.onChange({ target: { checked: true } }));
  await act(async () => { rModal2.root.findByType('form').props.onSubmit({ preventDefault() {} }); await pause(); });
  const secondIssueCalls = env.rpcCalls.filter((c) => c.name === 'issue_church_invitation');
  assert.equal(secondIssueCalls.length, 2);
  assert.equal(secondIssueCalls[1].args.p_command_id, firstIssueId, 'Remontagem de IssueInvitationModal nao preservou command_id');
  act(() => rModal2.unmount());

  // 2. AdminRequestsTab: envia -> timeout -> desmonta -> remonta -> repete -> preserva command_id
  let rAdmin1 = await mount(React.createElement(AuthProvider, null, React.createElement(AdminRequestsTab, { churchId })));
  await act(async () => rAdmin1.root.findByProps({ id: 'btn-approve-' + requestId }).props.onClick());
  await act(async () => { rAdmin1.root.findByProps({ id: 'btn-confirm-decision-execute' }).props.onClick(); await pause(); });
  const firstDecideId = env.rpcCalls.find((c) => c.name === 'decide_access_request').args.p_command_id;
  act(() => rAdmin1.unmount());

  let rAdmin2 = await mount(React.createElement(AuthProvider, null, React.createElement(AdminRequestsTab, { churchId })));
  await act(async () => rAdmin2.root.findByProps({ id: 'btn-approve-' + requestId }).props.onClick());
  await act(async () => { rAdmin2.root.findByProps({ id: 'btn-confirm-decision-execute' }).props.onClick(); await pause(); });
  const decideCalls = env.rpcCalls.filter((c) => c.name === 'decide_access_request');
  assert.equal(decideCalls.length, 2);
  assert.equal(decideCalls[1].args.p_command_id, firstDecideId, 'Remontagem de AdminRequestsTab nao preservou command_id');
  act(() => rAdmin2.unmount());
});

test('UI-error-state: falha ao carregar list_church_access_requests exibe mensagem simples com atualizacao e nao anuncia ausencia de dados nem expoe SQL', async (t) => {
  const env = setupEnvironment({
    user,
    rpcHandler: async (name) => {
      if (name === 'list_church_access_requests') {
        return {
          data: null,
          error: {
            message: 'structure of query does not match function result type: Returned varchar, expected text in column 6',
            code: '42804',
          },
        };
      }
      return empty();
    },
  });

  const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(AdminRequestsTab, { churchId })));
  t.after(() => act(() => renderer.unmount()));

  const text = visibleText(renderer);
  // Não anuncia "Nenhuma solicitação encontrada"
  assert.doesNotMatch(text, /nenhuma solicitação encontrada/i, 'Nao deve anunciar ausencia de dados quando houver erro');
  // Não expõe mensagem interna SQL
  assert.doesNotMatch(text, /structure of query does not match/i, 'Nao deve expor erro interno SQL');
  // Exibe mensagem simples e amigável
  assert.match(text, /não foi possível carregar as solicitações/i, 'Deve exibir mensagem compreensivel ao operador');
  // Oferece botão para tentar novamente / atualizar
  assert.match(text, /atualizar lista/i, 'Deve oferecer acao para atualizar/tentar novamente');
});
