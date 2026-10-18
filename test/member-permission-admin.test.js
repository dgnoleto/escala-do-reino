import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  permissionStorageKey,
  readPendingPermission,
  savePendingPermission,
  clearPendingPermission,
  formatPermissionErrorMessage,
  manageChurchAdmin,
} from '../src/utils/memberPermissionService.js';

// Prepara diretório de cache para compilação do componente MembersPage
const cacheDir = path.resolve(process.cwd(), 'node_modules', '.cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}
const bundlePath = path.join(cacheDir, 'members-permission-test-bundle.mjs');

await build({
  stdin: {
    contents: `
      export { default as MembersPage } from './src/components/MembersPage.jsx';
      export { AuthProvider, useAuth } from './src/context/AuthContext.jsx';
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
    name: 'review-transport-members-perm',
    setup(builder) {
      builder.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'transport', namespace: 'review' }));
      builder.onLoad({ filter: /.*/, namespace: 'review' }, () => ({
        contents: `
          export const supabase = {
            schema: (...args) => (globalThis.__reviewTransport?.schema ? globalThis.__reviewTransport.schema(...args) : supabase),
            rpc: (...args) => (globalThis.__reviewTransport?.rpc ? globalThis.__reviewTransport.rpc(...args) : Promise.resolve({ data: [], error: null })),
            auth: {
              onAuthStateChange: (...args) => (globalThis.__reviewTransport?.auth?.onAuthStateChange ? globalThis.__reviewTransport.auth.onAuthStateChange(...args) : { data: { subscription: { unsubscribe: () => {} } } }),
              getSession: (...args) => (globalThis.__reviewTransport?.auth?.getSession ? globalThis.__reviewTransport.auth.getSession(...args) : Promise.resolve({ data: { session: null }, error: null })),
              signOut: (...args) => (globalThis.__reviewTransport?.auth?.signOut ? globalThis.__reviewTransport.auth.signOut(...args) : Promise.resolve({ error: null })),
            },
          };
          export const isSupabaseConfigured = () => true;
        `,
        loader: 'js',
      }));
    },
  }],
});

const { MembersPage, AuthProvider } = await import(pathToFileURL(bundlePath).href);

// Mock simples de Storage em memória
function createMockStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

describe('Gestão de Permissões Administrativas — Service e Regras BDD (CA01 a CA04)', () => {
  it('1.1 permissionStorageKey gera chave isolada por usuário e igreja', () => {
    const key = permissionStorageKey('user-1', 'church-1');
    assert.equal(key, 'member_perm_cmd_user-1_church-1');
  });

  it('1.2 Ciclo de retenção e limpeza de comando pendente de permissão no storage', () => {
    const storage = createMockStorage();
    const cmd = {
      commandId: 'cmd-123',
      action: 'grant',
      targetMemberId: 'mem-456',
    };

    savePendingPermission(storage, 'user-1', 'church-1', cmd);
    const loaded = readPendingPermission(storage, 'user-1', 'church-1');
    assert.ok(loaded);
    assert.equal(loaded.commandId, 'cmd-123');
    assert.equal(loaded.action, 'grant');
    assert.equal(loaded.userId, 'user-1');
    assert.equal(loaded.churchId, 'church-1');

    // Leitura com usuário ou igreja divergente retorna null
    assert.equal(readPendingPermission(storage, 'user-2', 'church-1'), null);
    assert.equal(readPendingPermission(storage, 'user-1', 'church-2'), null);

    clearPendingPermission(storage, 'user-1', 'church-1');
    assert.equal(readPendingPermission(storage, 'user-1', 'church-1'), null);
  });

  it('1.3 formatPermissionErrorMessage mapeia erro 42501 (sem autorização admin)', () => {
    const msg = formatPermissionErrorMessage({ code: '42501' });
    assert.match(msg, /Você não possui permissão de administrador ativo/i);
  });

  it('1.4 formatPermissionErrorMessage mapeia erro 23514 de outra igreja (CA01)', () => {
    const msg = formatPermissionErrorMessage({
      code: '23514',
      message: 'Este membro já possui administração ativa em outra igreja.',
    });
    assert.match(msg, /já possui administração ativa em outra igreja/i);
  });

  it('1.5 formatPermissionErrorMessage mapeia erro 23514 do último administrador (CA02)', () => {
    const msg = formatPermissionErrorMessage({
      code: '23514',
      message: 'Operação não permitida: a igreja não pode ficar sem administrador ativo elegível.',
    });
    assert.match(msg, /não pode ficar sem pelo menos um administrador ativo/i);
  });

  it('1.6 formatPermissionErrorMessage mapeia erro 23505 (comando duplicado com parâmetros distintos)', () => {
    const msg = formatPermissionErrorMessage({ code: '23505' });
    assert.match(msg, /já foi enviado anteriormente/i);
  });

  it('1.7 formatPermissionErrorMessage mapeia erro 22023 (vínculo ou conta não confirmada)', () => {
    const msg = formatPermissionErrorMessage({
      code: '22023',
      message: 'Membro alvo não possui vínculo de acesso ativo e concluído.',
    });
    assert.match(msg, /ainda não concluiu a entrada com conta confirmada/i);
  });

  it('1.8 formatPermissionErrorMessage mapeia concorrência 40001 e ambiente sem suporte PGRST202', () => {
    assert.match(formatPermissionErrorMessage({ code: '40001' }), /alteração concorrente/i);
    assert.match(formatPermissionErrorMessage({ code: 'PGRST202' }), /ainda não está habilitada/i);
  });

  it('1.9 manageChurchAdmin valida parâmetros obrigatórios no cliente antes do envio', async () => {
    await assert.rejects(
      async () => manageChurchAdmin(null, { churchId: 'c1', targetMemberId: 'm1', action: 'grant' }),
      /Cliente Supabase não fornecido/i
    );
    await assert.rejects(
      async () => manageChurchAdmin({}, { churchId: '', targetMemberId: 'm1', action: 'grant' }),
      /Parâmetros obrigatórios ausentes/i
    );
  });

  it('1.10 manageChurchAdmin executa RPC com sucesso e retorna payload estruturado', async () => {
    const mockSupabase = {
      rpc: async (name, params) => {
        assert.equal(name, 'manage_church_admin');
        assert.equal(params.p_church_id, 'church-1');
        assert.equal(params.p_target_member_id, 'member-1');
        assert.equal(params.p_action, 'grant');
        assert.ok(params.p_command_id);
        return {
          data: [{ church_id: 'church-1', command_id: params.p_command_id, member_id: 'member-1', is_admin: true }],
          error: null,
        };
      },
    };

    const res = await manageChurchAdmin(mockSupabase, {
      churchId: 'church-1',
      targetMemberId: 'member-1',
      action: 'grant',
      commandId: 'cmd-abc-123',
    });

    assert.equal(res.success, true);
    assert.equal(res.data.is_admin, true);
    assert.equal(res.commandId, 'cmd-abc-123');
  });

  it('1.11 manageChurchAdmin formata falha do servidor em resposta estruturada', async () => {
    const mockSupabase = {
      rpc: async () => ({
        data: null,
        error: { code: '23514', message: 'sem administrador' },
      }),
    };

    const res = await manageChurchAdmin(mockSupabase, {
      churchId: 'church-1',
      targetMemberId: 'member-1',
      action: 'revoke',
    });

    assert.equal(res.success, false);
    assert.match(res.errorMessage, /não pode ficar sem pelo menos um administrador ativo/i);
  });
});

describe('Gestão de Permissões Administrativas — Interface e Modais em MembersPage (CA01 a CA04)', () => {
  const mockMembers = [
    {
      member_id: 'mem-1',
      display_name: 'Danilo Administrador',
      status: 'active',
      is_admin: true,
      is_current_user: true,
      has_active_access: true,
    },
    {
      member_id: 'mem-2',
      display_name: 'Lucas Membro Elegível',
      status: 'active',
      is_admin: false,
      is_current_user: false,
      has_active_access: true,
    },
    {
      member_id: 'mem-3',
      display_name: 'Marcos Segundo Admin',
      status: 'active',
      is_admin: true,
      is_current_user: false,
      has_active_access: true,
    },
    {
      member_id: 'mem-4',
      display_name: 'Membro Sem Conta',
      status: 'active',
      is_admin: false,
      is_current_user: false,
      has_active_access: false,
    },
  ];

  function setupEnvironment(membersData = mockMembers) {
    const storage = createMockStorage();
    const windowListeners = new Map();
    globalThis.window = {
      sessionStorage: storage,
      localStorage: storage,
      addEventListener: (evt, cb) => {
        if (!windowListeners.has(evt)) windowListeners.set(evt, []);
        windowListeners.get(evt).push(cb);
      },
      removeEventListener: (evt, cb) => {
        const arr = windowListeners.get(evt);
        if (arr) {
          const idx = arr.indexOf(cb);
          if (idx >= 0) arr.splice(idx, 1);
        }
      },
      dispatchEvent: () => {},
    };

    const docListeners = new Map();
    globalThis.document = {
      visibilityState: 'visible',
      addEventListener(evt, cb) {
        if (!docListeners.has(evt)) docListeners.set(evt, []);
        docListeners.get(evt).push(cb);
      },
      removeEventListener(evt, cb) {
        const arr = docListeners.get(evt);
        if (arr) {
          const idx = arr.indexOf(cb);
          if (idx >= 0) arr.splice(idx, 1);
        }
      },
      dispatchEvent: () => {},
    };

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    });

    const user = { id: 'user-1', email: 'danilo@example.com' };
    const churchAccess = {
      church_id: 'church-100',
      church_name: 'Igreja Central',
      is_admin: true,
      status: 'active',
    };

    globalThis.__reviewTransport = {
      schema: () => ({
        rpc: async (name) => {
          if (name === 'get_my_church_access') {
            return { data: [churchAccess], error: null };
          }
          if (name === 'list_church_members_admin') {
            return {
              data: [{ items: membersData, total_count: membersData.length }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
      }),
      rpc: async (name) => {
        if (name === 'get_my_church_access') {
          return { data: [churchAccess], error: null };
        }
        return { data: [], error: null };
      },
      auth: {
        onAuthStateChange: (cb) => {
          cb('SIGNED_IN', { user });
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        getSession: async () => ({ data: { session: { user } }, error: null }),
        signOut: async () => ({ error: null }),
      },
    };
  }

  async function mountMembersPage(membersData = mockMembers) {
    setupEnvironment(membersData);
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthProvider,
          null,
          React.createElement(MembersPage, {
            churchId: 'church-100',
            churchName: 'Igreja Central',
            isAdmin: true,
            currentUserId: 'user-1',
            authState: 'access_granted',
            churchAccess: { church_id: 'church-100', is_admin: true },
          })
        )
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    return renderer;
  }

  it('2.1 Renderiza badge "Admin" para membros com is_admin = true', async () => {
    const renderer = await mountMembersPage();
    const root = renderer.root;
    const adminBadges = root.findAllByProps({ className: 'badge badge-admin' });
    // Danilo e Marcos têm is_admin = true
    assert.equal(adminBadges.length, 2);
  });

  it('2.2 Renderiza ações de permissão adequadas conforme perfil e elegibilidade', async () => {
    const renderer = await mountMembersPage();
    const root = renderer.root;

    // Danilo (Admin logado / is_current_user) deve ter botão "Renunciar Admin"
    const renounceBtn = root.findByProps({ id: 'btn-revoke-admin-mem-1' });
    assert.ok(renounceBtn);
    assert.match(renounceBtn.props.title, /Renunciar à administração/i);

    // Lucas (Membro com acesso ativo e não-admin) deve ter botão "Tornar Admin"
    const grantBtn = root.findByProps({ id: 'btn-grant-admin-mem-2' });
    assert.ok(grantBtn);
    assert.match(grantBtn.props.title, /Conceder administração/i);

    // Marcos (Outro admin) deve ter botão "Retirar Admin"
    const revokeBtn = root.findByProps({ id: 'btn-revoke-admin-mem-3' });
    assert.ok(revokeBtn);
    assert.match(revokeBtn.props.title, /Retirar administração/i);

    // Membro Sem Conta (has_active_access = false) NÃO deve ter botão "Tornar Admin"
    const noAccessGrantBtn = root.findAllByProps({ id: 'btn-grant-admin-mem-4' });
    assert.equal(noAccessGrantBtn.length, 0);
  });

  it('2.3 Modal explica previamente os impactos ao conceder administração (CA04)', async () => {
    const renderer = await mountMembersPage();
    const root = renderer.root;
    const grantBtn = root.findByProps({ id: 'btn-grant-admin-mem-2' });

    await act(async () => {
      grantBtn.props.onClick();
    });

    const modalTitle = root.findByProps({ id: 'modal-perm-title' });
    assert.equal(modalTitle.children[0], 'Conceder Administração');

    // Confere se o texto do modal traz a explicação de impacto de CA03 e CA04
    const modalNode = root.findByProps({ 'aria-labelledby': 'modal-perm-title' });
    const modalText = JSON.stringify(renderer.toJSON());
    assert.match(modalText, /Lucas Membro Elegível/);
    assert.match(modalText, /não altera/i);
    assert.match(modalText, /não pode administrar ativamente mais de uma igreja/i);
  });

  it('2.4 Modal explica previamente os impactos ao renunciar à administração (CA04 / Saída Voluntária)', async () => {
    const renderer = await mountMembersPage();
    const root = renderer.root;
    const renounceBtn = root.findByProps({ id: 'btn-revoke-admin-mem-1' });

    await act(async () => {
      renounceBtn.props.onClick();
    });

    const modalTitle = root.findByProps({ id: 'modal-perm-title' });
    assert.equal(modalTitle.children[0], 'Renunciar à Administração');

    const modalText = JSON.stringify(renderer.toJSON());
    assert.match(modalText, /renunciar à sua permissão de administrador/i);
    assert.match(modalText, /Você continuará com acesso como membro comum/i);
    assert.match(modalText, /recusada se você for o único administrador ativo remanescente/i);
  });
});
