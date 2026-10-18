import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const cacheDir = path.resolve(process.cwd(), 'node_modules', '.cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}
const bundle = path.join(cacheDir, 'church-home-buttons.bundle.mjs');

await build({
  stdin: {
    contents: `export { default as ChurchHomePage } from './src/components/ChurchHomePage.jsx';`,
    resolveDir: process.cwd(),
    loader: 'jsx',
  },
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['react', 'react-dom', 'lucide-react'],
  plugins: [{
    name: 'home-test-transport',
    setup(builder) {
      builder.onResolve({ filter: /AuthContext$/ }, () => ({ path: 'auth', namespace: 'home-test' }));
      builder.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'transport', namespace: 'home-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'home-test' }, ({ path: name }) => ({
        contents: name === 'auth'
          ? 'export const useAuth = () => globalThis.__homeAuth;'
          : `export const supabase = {
              schema: () => ({ rpc: (...args) => globalThis.__homeRpc(...args) }),
              storage: { from: () => globalThis.__homeStorage }
            };`,
        loader: 'js',
      }));
    },
  }],
});

const { ChurchHomePage } = await import(pathToFileURL(bundle).href);
const churchId = '01700000-0000-4000-8000-000000000001';

let renderer;

function setup({ admin = true } = {}) {
  const values = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v),
      removeItem: (k) => values.delete(k),
    },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });

  globalThis.__homeAuth = {
    session: { user: { id: 'user-test', email: 'test@example.com' } },
    sessionId: 1,
    churchAccess: {
      church_id: churchId,
      church_name: 'Igreja Central',
      is_admin: admin,
      display_name: 'Danilo Noleto',
    },
    availableAccesses: [{ church_id: churchId, church_name: 'Igreja Central', is_admin: admin }],
    selectChurch() {},
    signOut() {},
    refreshAccess() {},
    recordCreationConfirmation() {},
    reloadChurchAccess() {},
  };

  globalThis.__homeStorage = {
    from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: 'https://example.invalid/logo.png' }, error: null }),
    }),
  };

  globalThis.__homeRpc = async (name) => {
    if (name === 'check_church_creation_eligibility') {
      return { data: [{ eligible: !admin }], error: null };
    }
    if (name === 'get_church_logo') {
      return { data: [{ logo_path: null }], error: null };
    }
    if (name === 'list_church_teams_overview') {
      return { data: [], error: null };
    }
    if (name === 'list_church_members') {
      return { data: [], error: null };
    }
    return { data: [], error: null };
  };
}

async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(ChurchHomePage));
  });
  return renderer;
}

async function unmount() {
  if (renderer) {
    await act(async () => renderer.unmount());
    renderer = null;
  }
}

test('CA01 e CA02: Botão Acessar Equipes tem estilo btn-primary padronizado com Membros e Dados da Igreja', async () => {
  try {
    setup({ admin: true });
    await mount();

    const btnTeams = renderer.root.findByProps({ id: 'btn-goto-teams' });
    const btnMembers = renderer.root.findByProps({ id: 'btn-goto-members' });
    const btnSettings = renderer.root.findByProps({ id: 'btn-goto-church-settings' });

    // CA01: Apresenta o mesmo padrão de classes dos outros acessos
    assert.equal(btnTeams.props.className, 'btn btn-primary church-home-admin-btn');
    assert.equal(btnMembers.props.className, 'btn btn-primary church-home-admin-btn');
    assert.equal(btnSettings.props.className, 'btn btn-primary church-home-admin-btn');

    // CA02: Texto visível preservado e nome acessível (aria-label) preservado
    assert.equal(btnTeams.props.children, 'Acessar Equipes');
    assert.equal(btnTeams.props['aria-label'], 'Acessar Ministérios e Equipes');
    assert.equal(btnTeams.props.type, 'button');
  } finally {
    await unmount();
  }
});

test('CA03: Acionar Acessar Equipes navega para a tela de Ministérios e Equipes', async () => {
  try {
    setup({ admin: true });
    await mount();

    const btnTeams = renderer.root.findByProps({ id: 'btn-goto-teams' });
    assert.ok(btnTeams, 'Botão btn-goto-teams deve existir');

    await act(async () => {
      btnTeams.props.onClick();
    });

    // Ao navegar para teams, renderiza a TeamsPage com teams-page-container
    const teamsContainers = renderer.root.findAllByProps({ className: 'teams-page-container' });
    assert.equal(teamsContainers.length, 1, 'Deve renderizar a tela TeamsPage após o clique');

    // Botão Voltar ao Início deve estar presente e permitir retornar para a página inicial
    const backBtn = renderer.root.findAllByType('button').find((b) =>
      Array.isArray(b.props.children)
        ? b.props.children.some((c) => typeof c === 'string' && c.includes('Voltar ao Início'))
        : typeof b.props.children === 'string' && b.props.children.includes('Voltar ao Início')
    );
    assert.ok(backBtn, 'Deve exibir botão para voltar ao início a partir da TeamsPage');

    // Clicando em Voltar ao Início retorna para a ChurchHomePage
    await act(async () => {
      backBtn.props.onClick();
    });
    assert.ok(renderer.root.findByProps({ id: 'btn-goto-teams' }), 'Deve voltar para a ChurchHomePage');
  } finally {
    await unmount();
  }
});

test('CA05: Permissões preservadas — membro básico vê Acessar Equipes padronizado, mas não Membros nem Dados da Igreja', async () => {
  try {
    setup({ admin: false });
    await mount();

    // Membro básico vê o botão de equipes com o mesmo estilo padronizado
    const btnTeams = renderer.root.findByProps({ id: 'btn-goto-teams' });
    assert.ok(btnTeams, 'Membro básico deve ter acesso a equipes');
    assert.equal(btnTeams.props.className, 'btn btn-primary church-home-admin-btn');
    assert.equal(btnTeams.props['aria-label'], 'Acessar Ministérios e Equipes');

    // Membro básico NÃO vê botões exclusivos de admin
    const btnMembers = renderer.root.findAllByProps({ id: 'btn-goto-members' });
    const btnSettings = renderer.root.findAllByProps({ id: 'btn-goto-church-settings' });
    assert.equal(btnMembers.length, 0, 'Membro básico não deve ver Acessar Membros');
    assert.equal(btnSettings.length, 0, 'Membro básico não deve ver Acessar Dados da Igreja');
  } finally {
    await unmount();
  }
});
