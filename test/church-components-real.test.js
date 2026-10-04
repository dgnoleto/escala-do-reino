import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Prepara diretório de cache em node_modules (ignorado pelo git)
const cacheDir = path.resolve(process.cwd(), 'node_modules', '.cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}
const bundlePath = path.join(cacheDir, 'review-components.bundle.mjs');

// Transpila os componentes publicados de produção sem alterar sua lógica, substituindo apenas o transporte Supabase
await build({
  stdin: {
    contents: `export { default as App } from './src/App.jsx';
      export { AuthProvider, useAuth } from './src/context/AuthContext.jsx';
      export { default as CreateChurchModal } from './src/components/CreateChurchModal.jsx';`,
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
        contents: `export const supabase = {
          schema: (...args) => globalThis.__reviewTransport.schema(...args),
          auth: {
            onAuthStateChange: (...args) => globalThis.__reviewTransport.auth.onAuthStateChange(...args),
            getSession: (...args) => globalThis.__reviewTransport.auth.getSession(...args),
            signOut: (...args) => globalThis.__reviewTransport.auth.signOut(...args),
          }
        };
        export const isSupabaseConfigured = () => true;`,
        loader: 'js',
      }));
    },
  }],
});

const { App, AuthProvider, useAuth, CreateChurchModal } = await import(pathToFileURL(bundlePath).href);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(options = {}) {
  const items = new Map();
  const storage = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, String(v)),
    removeItem: (k) => items.delete(k),
    key: (i) => [...items.keys()][i] ?? null,
    get length() { return items.size; },
  };

  globalThis.window = { sessionStorage: storage, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });

  const creation = deferred();
  const accessAfterCreation = deferred();
  const calls = [];
  let authListener;
  let accessCalls = 0;

  const defaultUser = { id: 'review-user', email: 'review@example.invalid', user_metadata: { full_name: 'Pastor Teste' } };
  const session = { user: options.user || defaultUser };
  const row = {
    church_id: 'review-church',
    member_id: 'review-member',
    church_name: 'Igreja Confirmada',
    display_name: 'Pastor Teste',
    is_admin: true,
  };

  globalThis.__reviewTransport = {
    auth: {
      onAuthStateChange: (cb) => {
        authListener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session } }),
      signOut: async () => {
        if (authListener) authListener('SIGNED_OUT', null);
        return { error: null };
      },
      // Permite simular troca de conta no teste
      simulateAccountSwitch: (newUser) => {
        if (authListener) {
          authListener('SIGNED_IN', { user: newUser });
        }
      },
    },
    schema: () => ({
      rpc(name, args) {
        calls.push({ name, args });
        if (name === 'get_my_church_access') {
          accessCalls++;
          if (accessCalls === 1) return Promise.resolve({ data: [], error: null });
          if (accessCalls === 2) return accessAfterCreation.promise;
          return Promise.resolve({ data: [row], error: null });
        }
        if (name === 'check_church_creation_eligibility') {
          return Promise.resolve({ data: [{ eligible: true, reason: 'eligible' }], error: null });
        }
        if (name === 'create_my_church') return creation.promise;
        throw new Error('Unexpected review RPC: ' + name);
      },
    }),
  };

  return { storage, calls, creation, accessAfterCreation, row, getAuthListener: () => authListener };
}

async function mount(element) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
    await new Promise((r) => setTimeout(r, 20));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  return renderer;
}

async function submit(renderer, openModal = true) {
  if (openModal) {
    await act(async () => {
      renderer.root.findByProps({ id: 'btn-open-create-church-pending' }).props.onClick();
    });
  }
  await act(async () => {
    renderer.root.findByProps({ id: 'input-church-name' }).props.onChange({ target: { value: 'Igreja Confirmada' } });
  });
  let promise;
  act(() => {
    promise = renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
  });
  return { promise };
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

describe('Testes com Componentes de Produção e React Test Renderer (Execução Real de Código de Produção)', () => {
  test('1. Modal real de produção: logout no AuthContext durante RPC em voo descarta callback e bloqueia onSuccess', async () => {
    const fixture = setup();
    let currentAuth;
    let successes = 0;
    function Probe() {
      currentAuth = useAuth();
      return null;
    }
    const renderer = await mount(
      React.createElement(AuthProvider, null,
        React.createElement(Probe),
        React.createElement(CreateChurchModal, {
          isOpen: true,
          onClose() {},
          onSuccess() { successes++; },
        })
      )
    );
    try {
      const { promise } = await submit(renderer, false);
      await act(async () => {
        await currentAuth.signOut();
        fixture.creation.resolve({ data: [fixture.row], error: null });
        await promise;
      });
      assert.equal(successes, 0, 'onSuccess não deve ser disparado após logout do AuthContext');
      assert.equal(fixture.storage.getItem('church_creation_cmd_review-user'), null);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test('2. App real de produção: criação confirmada seguida de recarga de acesso bem-sucedida seleciona a igreja criada', async () => {
    const fixture = setup();
    const renderer = await mount(React.createElement(App));
    try {
      const { promise } = await submit(renderer);
      await act(async () => {
        fixture.creation.resolve({ data: [fixture.row], error: null });
        await promise;
        fixture.accessAfterCreation.resolve({ data: [fixture.row], error: null });
        await new Promise((r) => setTimeout(r, 10));
      });
      assert.equal(fixture.storage.getItem('selected_church_review-user'), fixture.row.church_id);
      assert.match(visibleText(renderer), /Igreja Confirmada/);
      assert.equal(renderer.root.findAllByProps({ id: 'btn-goto-members' }).length, 1);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test('3. App real de produção: criação confirmada com falha na recarga preserva confirmação visível na tela ativa (AccessErrorPage)', async () => {
    const fixture = setup();
    const renderer = await mount(React.createElement(App));
    try {
      const { promise } = await submit(renderer);
      await act(async () => {
        fixture.creation.resolve({ data: [fixture.row], error: null });
        await promise;
        fixture.accessAfterCreation.resolve({ data: null, error: { code: '500', message: 'Transport failure' } });
        await new Promise((r) => setTimeout(r, 10));
      });

      const textAfterFailure = visibleText(renderer);
      assert.equal(fixture.storage.getItem('selected_church_review-user'), fixture.row.church_id);
      assert.match(
        textAfterFailure,
        /igreja.{0,35}(criada|confirmada)|cria[çc][ãa]o.{0,35}confirmada/i,
        'Criação confirmada deve ser exibida na tela montada após falha na consulta de acesso.'
      );

      // 4. Retry na mesma igreja sem outra chamada create_my_church
      await act(async () => {
        renderer.root.findByProps({ id: 'btn-retry-access' }).props.onClick();
        await new Promise((r) => setTimeout(r, 10));
      });
      assert.match(visibleText(renderer), /Igreja Confirmada/);
      assert.equal(fixture.calls.filter((call) => call.name === 'create_my_church').length, 1, 'Não deve reexecutar create_my_church no retry');
    } finally {
      act(() => renderer.unmount());
    }
  });

  test('4. App real de produção: logout durante espera ou erro de recarga limpa a confirmação e impede vazamento para conta seguinte', async () => {
    const fixture = setup();
    const renderer = await mount(React.createElement(App));
    try {
      const { promise } = await submit(renderer);
      await act(async () => {
        fixture.creation.resolve({ data: [fixture.row], error: null });
        await promise;
        fixture.accessAfterCreation.resolve({ data: null, error: { code: '500', message: 'Transport failure' } });
        await new Promise((r) => setTimeout(r, 10));
      });

      // Tela de erro exibe confirmação
      assert.match(visibleText(renderer), /Sua igreja/);

      // Clica em sair na tela de erro
      await act(async () => {
        renderer.root.findByProps({ id: 'btn-signout-error' }).props.onClick();
        await new Promise((r) => setTimeout(r, 10));
      });

      // Agora deslogado, vai para LoginPage
      assert.match(visibleText(renderer), /Escala do Reino/);
      assert.equal(renderer.root.findAllByProps({ id: 'btn-retry-access' }).length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
