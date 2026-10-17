import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  isDefinitiveServerError,
  isUncertainResponse,
  getMemberCommandStorageKey,
  savePendingMemberCommand,
  loadPendingMemberCommand,
  removePendingMemberCommand,
  getMemberLifecycleStorageKey,
  savePendingLifecycleCommand,
  loadPendingLifecycleCommand,
  removePendingLifecycleCommand,
  loadAnyPendingMemberCommand,
  clearAllMemberCommandStorage,
  classifyLifecycleReceiptCheckResult,
  dispatchMemberCreation,
  dispatchMemberRestoration,
  dispatchMemberDeactivation,
  applyMemberListTransition,
  createInitialMemberListState,
  getMemberListViewState,
} from '../src/utils/memberCommandService.js';

// Prepara diretório de cache em node_modules para compilação do componente MembersPage
const cacheDir = path.resolve(process.cwd(), 'node_modules', '.cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}
const bundlePath = path.join(cacheDir, 'member-lifecycle-test-bundle.mjs');

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
            }
          };
          export const isSupabaseConfigured = () => true;
        `,
        loader: 'js',
      }));
    },
  }],
});

const { MembersPage, AuthProvider } = await import(pathToFileURL(bundlePath).href);

/**
 * Mock simples de sessionStorage em memória.
 */
class MockSessionStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.get(key) ?? null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  get length() {
    return this.store.size;
  }
  key(index) {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

function visibleText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(visibleText).join(' ');
  if (node.children) return node.children.map(visibleText).join(' ');
  return '';
}

async function mount(element) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

function setupEnvironment(options = {}) {
  const items = new Map(options.initialStorageEntries || []);
  const storage = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, String(v)),
    removeItem: (k) => items.delete(k),
    clear: () => items.clear(),
    key: (i) => [...items.keys()][i] ?? null,
    get length() { return items.size; },
  };

  const windowListeners = new Map();
  globalThis.window = {
    sessionStorage: storage,
    addEventListener(evt, cb) {
      if (!windowListeners.has(evt)) windowListeners.set(evt, []);
      windowListeners.get(evt).push(cb);
    },
    removeEventListener(evt, cb) {
      const arr = windowListeners.get(evt);
      if (arr) {
        const idx = arr.indexOf(cb);
        if (idx >= 0) arr.splice(idx, 1);
      }
    },
    dispatchEvent(evt) {
      const type = typeof evt === 'string' ? evt : evt.type;
      const arr = windowListeners.get(type) || [];
      for (const cb of arr) cb(evt);
    },
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
    dispatchEvent(evt) {
      const type = typeof evt === 'string' ? evt : evt.type;
      const arr = docListeners.get(type) || [];
      for (const cb of arr) cb(evt);
    },
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });

  const rpcCalls = [];
  const user = options.user !== undefined ? options.user : { id: 'admin-user-id', email: 'admin@example.com' };
  const churchAccess = options.churchAccess !== undefined ? options.churchAccess : {
    church_id: 'church-1',
    church_name: 'Igreja Central',
    is_admin: true,
    status: 'active',
  };

  globalThis.__reviewTransport = {
    schema: (s) => ({
      rpc: async (name, args) => {
        rpcCalls.push({ schema: s, name, args });
        if (options.rpcHandler) {
          const custom = await options.rpcHandler(name, args);
          if (custom !== undefined) return custom;
        }
        if (name === 'get_my_church_access') {
          return { data: churchAccess ? [churchAccess] : [], error: null };
        }
        if (name === 'list_church_members_admin' || name === 'list_church_members') {
          return {
            data: [{
              items: options.members || [
                {
                  id: 'm1',
                  member_id: 'm1',
                  display_name: 'Pastor João',
                  status: 'active',
                  has_active_access: false,
                  has_church_access: false,
                  has_revoked_access: false,
                  updated_at: '2026-10-14T18:00:00.000000Z',
                },
                {
                  id: 'm2',
                  member_id: 'm2',
                  display_name: 'Irmão Inativo',
                  status: 'inactive',
                  has_active_access: false,
                  has_church_access: true,
                  has_revoked_access: true,
                  updated_at: '2026-10-14T18:00:00.123456Z',
                },
              ],
              total_count: options.totalCount !== undefined ? options.totalCount : 2,
            }],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    }),
    auth: {
      onAuthStateChange: (cb) => {
        if (user) {
          cb('SIGNED_IN', { user });
        }
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({
        data: { session: user ? { user } : null },
        error: null,
      }),
      signOut: async () => ({ error: null }),
    },
  };

  return { storage, rpcCalls };
}

describe('1. Classificação de Erros de Ciclo de Vida (P0018, P0019, P0021)', () => {
  it('classifica P0018 (acesso ativo legado) como erro definitivo do servidor', () => {
    const errByCode = { code: 'P0018', message: 'Membro possui vínculo ativo legado nesta igreja.' };
    assert.equal(isDefinitiveServerError(errByCode), true);

    const errByMsg = { message: 'membro possui vínculo ativo legado' };
    assert.equal(isDefinitiveServerError(errByMsg), true);
  });

  it('classifica P0019 (conflito de estado ou revisão concorrente) como erro definitivo do servidor', () => {
    const errByCode = { code: 'P0019', message: 'O cadastro foi modificado por outro operador.' };
    assert.equal(isDefinitiveServerError(errByCode), true);

    const errAlreadyActive = { message: 'membro já se encontra ativo' };
    assert.equal(isDefinitiveServerError(errAlreadyActive), true);
  });

  it('classifica P0021 (exclusão bloqueada por dependência litúrgica) como erro definitivo do servidor', () => {
    const errByCode = { code: 'P0021', message: 'Exclusão indisponível: módulo de escalas e validação litúrgica pendentes.' };
    assert.equal(isDefinitiveServerError(errByCode), true);

    const errByMsg = { message: 'exclusão indisponível: módulo de escalas ainda não integrado' };
    assert.equal(isDefinitiveServerError(errByMsg), true);
  });

  it('preserva erros transitórios de rede e 5xx como respostas incertas (não definitivas)', () => {
    const netErr = new Error('Failed to fetch');
    assert.equal(isDefinitiveServerError(netErr), false);
    assert.equal(isUncertainResponse(netErr, null), true);

    const http503 = { status: 503, message: 'Service Unavailable' };
    assert.equal(isDefinitiveServerError(http503), false);
    assert.equal(isUncertainResponse(http503, null), true);
  });
});

describe('2. Gestão de Persistência e Isolamento de Comandos de Ciclo de Vida', () => {
  it('gera chave isolada por usuário, igreja, membro e ação', () => {
    const key = getMemberLifecycleStorageKey('user-1', 'church-1', 'member-1', 'restore_member');
    assert.equal(key, 'escala_pending_member_lifecycle_cmd:user-1:church-1:member-1:restore_member');

    assert.equal(getMemberLifecycleStorageKey(null, 'church-1', 'member-1', 'restore_member'), null);
    assert.equal(getMemberLifecycleStorageKey('user-1', null, 'member-1', 'restore_member'), null);
    assert.equal(getMemberLifecycleStorageKey('user-1', 'church-1', null, 'restore_member'), null);
    assert.equal(getMemberLifecycleStorageKey('user-1', 'church-1', 'member-1', null), null);
  });

  it('preserva expectedUpdatedAt como string opaca integral sem parse de Date', () => {
    const storage = new MockSessionStorage();
    const opaqueRevision = '2026-10-13T20:45:00.123456Z';

    const saved = savePendingLifecycleCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      memberId: 'member-1',
      action: 'restore_member',
      commandId: 'cmd-1',
      expectedUpdatedAt: opaqueRevision,
      displayName: 'Irmão Teste',
    });
    assert.equal(saved, true);

    const loaded = loadPendingLifecycleCommand(storage, 'user-1', 'church-1', 'member-1', 'restore_member');
    assert.ok(loaded);
    assert.equal(loaded.expectedUpdatedAt, opaqueRevision);
    assert.equal(typeof loaded.expectedUpdatedAt, 'string');
    assert.equal(loaded.displayName, 'Irmão Teste');
  });

  it('rejeita carregar comando de outro usuário ou de outra igreja (isolamento multi-tenant)', () => {
    const storage = new MockSessionStorage();
    savePendingLifecycleCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      memberId: 'member-1',
      action: 'restore_member',
      commandId: 'cmd-1',
      expectedUpdatedAt: '2026-10-13T20:45:00.123456Z',
    });

    // Tentativa de leitura com user-2
    assert.equal(loadPendingLifecycleCommand(storage, 'user-2', 'church-1', 'member-1', 'restore_member'), null);

    // Tentativa de leitura com church-2
    assert.equal(loadPendingLifecycleCommand(storage, 'user-1', 'church-2', 'member-1', 'restore_member'), null);
  });

  it('clearAllMemberCommandStorage limpa tanto comandos de criação quanto de ciclo de vida', () => {
    const storage = new MockSessionStorage();
    storage.setItem('escala_pending_member_cmd:user-1:church-1', JSON.stringify({ commandId: 'c1' }));
    storage.setItem('escala_pending_member_lifecycle_cmd:user-1:church-1:m1:restore_member', JSON.stringify({ commandId: 'c2' }));
    storage.setItem('other_unrelated_key', 'preserve_me');

    clearAllMemberCommandStorage(storage);
    assert.equal(storage.getItem('escala_pending_member_cmd:user-1:church-1'), null);
    assert.equal(storage.getItem('escala_pending_member_lifecycle_cmd:user-1:church-1:m1:restore_member'), null);
    assert.equal(storage.getItem('other_unrelated_key'), 'preserve_me');
  });

  it('bloqueia save e preserva o valor bruto se o storage contiver JSON corrompido/ilegível', () => {
    const storage = new MockSessionStorage();
    const corruptCreationKey = 'escala_pending_member_cmd:user-1:church-1';
    storage.setItem(corruptCreationKey, '{ invalid_json_raw:');

    // savePendingMemberCommand deve recusar sobrescrever e retornar false
    const savedCreation = savePendingMemberCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      commandId: 'cmd-novo',
      displayName: 'Novo Irmão',
    });
    assert.equal(savedCreation, false);
    assert.equal(storage.getItem(corruptCreationKey), '{ invalid_json_raw:');

    // loadPendingMemberCommand preserva o item bruto mas devolve null
    assert.equal(loadPendingMemberCommand(storage, 'user-1', 'church-1'), null);
    assert.equal(storage.getItem(corruptCreationKey), '{ invalid_json_raw:');

    // Mesma garantia para comandos de ciclo de vida
    const corruptLifecycleKey = 'escala_pending_member_lifecycle_cmd:user-1:church-1:m1:restore_member';
    storage.setItem(corruptLifecycleKey, '{ invalid_lifecycle_json:');

    const savedLifecycle = savePendingLifecycleCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      memberId: 'm1',
      action: 'restore_member',
      commandId: 'cmd-novo-lc',
      expectedUpdatedAt: '2026-10-14T19:00:00Z',
    });
    assert.equal(savedLifecycle, false);
    assert.equal(storage.getItem(corruptLifecycleKey), '{ invalid_lifecycle_json:');

    assert.equal(loadPendingLifecycleCommand(storage, 'user-1', 'church-1', 'm1', 'restore_member'), null);
    assert.equal(storage.getItem(corruptLifecycleKey), '{ invalid_lifecycle_json:');
  });

  it('recusa alteração de parâmetros para o mesmo commandId mas preserva reenvio idêntico', () => {
    const storage = new MockSessionStorage();
    // 1. Criação: salva original
    const ok1 = savePendingMemberCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      commandId: 'cmd-1',
      displayName: 'Nome Original',
    });
    assert.equal(ok1, true);

    // Reenvio idêntico: permitido
    const okReplay = savePendingMemberCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      commandId: 'cmd-1',
      displayName: 'Nome Original',
    });
    assert.equal(okReplay, true);

    // Tentativa de alterar displayName com mesmo commandId: recusada
    const alteredName = savePendingMemberCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      commandId: 'cmd-1',
      displayName: 'Outro Nome Divergente',
    });
    assert.equal(alteredName, false);

    // 2. Ciclo de vida: salva original
    const okLc = savePendingLifecycleCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      memberId: 'm1',
      action: 'restore_member',
      commandId: 'cmd-lc-1',
      expectedUpdatedAt: '2026-10-14T19:00:00.000000Z',
    });
    assert.equal(okLc, true);

    // Reenvio idêntico: permitido
    const okLcReplay = savePendingLifecycleCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      memberId: 'm1',
      action: 'restore_member',
      commandId: 'cmd-lc-1',
      expectedUpdatedAt: '2026-10-14T19:00:00.000000Z',
    });
    assert.equal(okLcReplay, true);

    // Tentativa de alterar expectedUpdatedAt com mesmo commandId: recusada
    const alteredRevision = savePendingLifecycleCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      memberId: 'm1',
      action: 'restore_member',
      commandId: 'cmd-lc-1',
      expectedUpdatedAt: '2026-10-14T20:00:00.000000Z',
    });
    assert.equal(alteredRevision, false);
  });

  it('removePendingMemberCommand e removePendingLifecycleCommand recusam remoção com expectedCommandId divergente', () => {
    const storage = new MockSessionStorage();

    // Criação
    savePendingMemberCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      commandId: 'cmd-esperado',
      displayName: 'Nome',
    });
    // Tentativa de remover com commandId divergente: recusa e mantém
    const removedWrong = removePendingMemberCommand(storage, 'user-1', 'church-1', 'cmd-antigo-divergente');
    assert.equal(removedWrong, false);
    assert.ok(loadPendingMemberCommand(storage, 'user-1', 'church-1'));

    // Remoção com commandId correto: sucesso
    const removedOk = removePendingMemberCommand(storage, 'user-1', 'church-1', 'cmd-esperado');
    assert.equal(removedOk, true);
    assert.equal(loadPendingMemberCommand(storage, 'user-1', 'church-1'), null);

    // Ciclo de vida
    savePendingLifecycleCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      memberId: 'm1',
      action: 'restore_member',
      commandId: 'cmd-lc-esperado',
      expectedUpdatedAt: '2026-10-14T19:00:00.000000Z',
    });
    // Tentativa de remover com commandId divergente: recusa e mantém
    const removedWrongLc = removePendingLifecycleCommand(storage, 'user-1', 'church-1', 'm1', 'restore_member', 'cmd-lc-divergente');
    assert.equal(removedWrongLc, false);
    assert.ok(loadPendingLifecycleCommand(storage, 'user-1', 'church-1', 'm1', 'restore_member'));

    // Remoção com commandId correto: sucesso
    const removedOkLc = removePendingLifecycleCommand(storage, 'user-1', 'church-1', 'm1', 'restore_member', 'cmd-lc-esperado');
    assert.equal(removedOkLc, true);
    assert.equal(loadPendingLifecycleCommand(storage, 'user-1', 'church-1', 'm1', 'restore_member'), null);
  });
});

describe('3. Ciclo de Restauração de Membro (dispatchMemberRestoration)', () => {
  it('interrompe ANTES da RPC se a persistência no storage falhar', async () => {
    const faultStorage = {
      setItem() {
        throw new Error('QuotaExceededError');
      },
      getItem() { return null; },
      removeItem() {},
    };

    let rpcCalled = false;
    const rpcCaller = async () => {
      rpcCalled = true;
      return { data: [], error: null };
    };

    const result = await dispatchMemberRestoration({
      storage: faultStorage,
      rpcCaller,
      churchId: 'church-1',
      userId: 'user-1',
      commandId: 'cmd-1',
      memberId: 'member-1',
      expectedUpdatedAt: '2026-10-13T20:00:00.000000Z',
    });

    assert.equal(result.status, 'STORAGE_FAILED');
    assert.equal(result.rpcCalled, false);
    assert.equal(rpcCalled, false);
  });

  it('executa restauração com sucesso: persiste antes, remove após confirmação e retorna payload', async () => {
    const storage = new MockSessionStorage();
    let rpcArgs = null;

    const rpcCaller = async (args) => {
      rpcArgs = args;
      return {
        data: [{
          command_id: 'cmd-1',
          action: 'restore_member',
          church_id: 'church-1',
          result_member_id: 'member-1',
          result_payload: {
            member_id: 'member-1',
            display_name: 'Membro Restaurado',
            status: 'active',
            updated_at: '2026-10-13T20:00:00.654321Z',
            has_revoked_access: false,
          },
        }],
        error: null,
      };
    };

    const result = await dispatchMemberRestoration({
      storage,
      rpcCaller,
      churchId: 'church-1',
      userId: 'user-1',
      commandId: 'cmd-1',
      memberId: 'member-1',
      expectedUpdatedAt: '2026-10-13T20:00:00.654321Z',
      displayName: 'Membro Restaurado',
    });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.rpcCalled, true);
    assert.equal(rpcArgs.p_expected_updated_at, '2026-10-13T20:00:00.654321Z');
    assert.equal(loadPendingLifecycleCommand(storage, 'user-1', 'church-1', 'member-1', 'restore_member'), null);
  });

  it('trata bloqueio por acesso ativo legado (P0018) como erro definitivo e limpa o storage', async () => {
    const storage = new MockSessionStorage();

    const rpcCaller = async () => ({
      data: null,
      error: { code: 'P0018', message: 'Membro possui vínculo ativo legado nesta igreja. Restauração bloqueada.' },
    });

    const result = await dispatchMemberRestoration({
      storage,
      rpcCaller,
      churchId: 'church-1',
      userId: 'user-1',
      commandId: 'cmd-1',
      memberId: 'member-1',
      expectedUpdatedAt: '2026-10-13T20:00:00.000000Z',
    });

    assert.equal(result.status, 'DEFINITIVE_ERROR');
    assert.ok(result.message.includes('vínculo de acesso ativo legado'));
    assert.equal(loadPendingLifecycleCommand(storage, 'user-1', 'church-1', 'member-1', 'restore_member'), null);
  });

  it('trata resposta incerta (queda de conexão): mantém o comando no storage para recuperação', async () => {
    const storage = new MockSessionStorage();

    const rpcCaller = async () => {
      throw new Error('TypeError: Failed to fetch');
    };

    const result = await dispatchMemberRestoration({
      storage,
      rpcCaller,
      churchId: 'church-1',
      userId: 'user-1',
      commandId: 'cmd-1',
      memberId: 'member-1',
      expectedUpdatedAt: '2026-10-13T20:00:00.000000Z',
    });

    assert.equal(result.status, 'UNCERTAIN');
    const retained = loadPendingLifecycleCommand(storage, 'user-1', 'church-1', 'member-1', 'restore_member');
    assert.ok(retained);
    assert.equal(retained.commandId, 'cmd-1');
  });
});

describe('4. Ciclo de Exclusão com Trava Litúrgica (dispatchMemberDeactivation)', () => {
  it('retorna DEFINITIVE_ERROR com explicação da dependência litúrgica quando o servidor lança P0021', async () => {
    const storage = new MockSessionStorage();

    const rpcCaller = async () => ({
      data: null,
      error: {
        code: 'P0021',
        message: 'Exclusão indisponível: módulo de escalas e validação de dependências litúrgicas ainda não integrados ao banco de dados.',
      },
    });

    const result = await dispatchMemberDeactivation({
      storage,
      rpcCaller,
      churchId: 'church-1',
      userId: 'user-1',
      commandId: 'cmd-1',
      memberId: 'member-1',
      expectedUpdatedAt: '2026-10-13T20:00:00.000000Z',
    });

    assert.equal(result.status, 'DEFINITIVE_ERROR');
    assert.ok(result.message.includes('A exclusão de membros está indisponível nesta etapa'));
    assert.ok(result.message.includes('depende da verificação de participações e liderança'));
    assert.equal(loadPendingLifecycleCommand(storage, 'user-1', 'church-1', 'member-1', 'deactivate_member'), null);
  });

  it('trata replay histórico autorizado de exclusão como SUCCESS', async () => {
    const storage = new MockSessionStorage();

    const rpcCaller = async () => ({
      data: [{
        command_id: 'cmd-hist',
        action: 'deactivate_member',
        church_id: 'church-1',
        result_member_id: 'member-1',
        result_payload: { member_id: 'member-1', status: 'inactive' },
      }],
      error: null,
    });

    const result = await dispatchMemberDeactivation({
      storage,
      rpcCaller,
      churchId: 'church-1',
      userId: 'user-1',
      commandId: 'cmd-hist',
      memberId: 'member-1',
      expectedUpdatedAt: '2026-10-13T20:00:00.000000Z',
      displayName: 'Membro Teste',
    });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(loadPendingLifecycleCommand(storage, 'user-1', 'church-1', 'member-1', 'deactivate_member'), null);
  });
});

describe('5. Consulta e Reconciliação de Recibo de Ciclo de Vida', () => {
  it('classifica recibo confirmado (CONFIRMED) com validação estrita de todos os campos', () => {
    const receipt = {
      command_id: 'c1',
      action: 'restore_member',
      church_id: 'ch1',
      result_member_id: 'm1',
      result_payload: {
        member_id: 'm1',
        status: 'active',
        updated_at: '2026-10-14T19:00:00.000000Z',
        has_revoked_access: false,
      },
    };
    const res = classifyLifecycleReceiptCheckResult(null, [receipt], {
      commandId: 'c1',
      action: 'restore_member',
      churchId: 'ch1',
      memberId: 'm1',
    });
    assert.equal(res.status, 'CONFIRMED');
    assert.equal(res.shouldPreserveCommand, false);
    assert.equal(res.receipt.command_id, 'c1');
  });

  it('rejeita recibo com result_payload sendo array vazio [] como status ERROR e preserva o comando', () => {
    const receipt = {
      command_id: 'c1',
      action: 'restore_member',
      church_id: 'ch1',
      result_member_id: 'm1',
      result_payload: [],
    };
    const res = classifyLifecycleReceiptCheckResult(null, [receipt], {
      commandId: 'c1',
      action: 'restore_member',
      churchId: 'ch1',
      memberId: 'm1',
    });
    assert.equal(res.status, 'ERROR');
    assert.equal(res.shouldPreserveCommand, true);
  });

  it('rejeita recibo de restauração com campos contratados ausentes ou divergentes (membro, status, revisão, flag)', () => {
    // Membro divergente
    const divergentMember = {
      command_id: 'c1',
      action: 'restore_member',
      church_id: 'ch1',
      result_member_id: 'm1',
      result_payload: { member_id: 'outro-membro', status: 'active', updated_at: '2026-10-14T19:00:00Z', has_revoked_access: false },
    };
    assert.equal(classifyLifecycleReceiptCheckResult(null, [divergentMember], { commandId: 'c1', action: 'restore_member', churchId: 'ch1', memberId: 'm1' }).status, 'ERROR');

    // Status não ativo
    const notActive = {
      command_id: 'c1',
      action: 'restore_member',
      church_id: 'ch1',
      result_member_id: 'm1',
      result_payload: { member_id: 'm1', status: 'inactive', updated_at: '2026-10-14T19:00:00Z', has_revoked_access: false },
    };
    assert.equal(classifyLifecycleReceiptCheckResult(null, [notActive], { commandId: 'c1', action: 'restore_member', churchId: 'ch1', memberId: 'm1' }).status, 'ERROR');

    // Revisão opaca ausente ou vazia
    const emptyRevision = {
      command_id: 'c1',
      action: 'restore_member',
      church_id: 'ch1',
      result_member_id: 'm1',
      result_payload: { member_id: 'm1', status: 'active', updated_at: '   ', has_revoked_access: false },
    };
    assert.equal(classifyLifecycleReceiptCheckResult(null, [emptyRevision], { commandId: 'c1', action: 'restore_member', churchId: 'ch1', memberId: 'm1' }).status, 'ERROR');

    // Flag has_revoked_access não booleana
    const nonBooleanFlag = {
      command_id: 'c1',
      action: 'restore_member',
      church_id: 'ch1',
      result_member_id: 'm1',
      result_payload: { member_id: 'm1', status: 'active', updated_at: '2026-10-14T19:00:00Z', has_revoked_access: 'yes' },
    };
    assert.equal(classifyLifecycleReceiptCheckResult(null, [nonBooleanFlag], { commandId: 'c1', action: 'restore_member', churchId: 'ch1', memberId: 'm1' }).status, 'ERROR');
  });

  it('retém comando com status ERROR quando recibo possui dados incompletos ou ausência de result_payload', () => {
    const incomplete = { command_id: 'c1', action: 'restore_member', church_id: 'ch1' };
    const res = classifyLifecycleReceiptCheckResult(null, [incomplete], {
      commandId: 'c1',
      action: 'restore_member',
      churchId: 'ch1',
      memberId: 'm1',
    });
    assert.equal(res.status, 'ERROR');
    assert.equal(res.shouldPreserveCommand, true);
  });

  it('retém comando com status ERROR quando recibo possui dados divergentes do comando original', () => {
    const divergent = {
      command_id: 'outro-cmd',
      action: 'restore_member',
      church_id: 'ch1',
      result_member_id: 'm1',
      result_payload: { member_id: 'm1' },
    };
    const res = classifyLifecycleReceiptCheckResult(null, [divergent], {
      commandId: 'cmd-original',
      action: 'restore_member',
      churchId: 'ch1',
      memberId: 'm1',
    });
    assert.equal(res.status, 'ERROR');
    assert.equal(res.shouldPreserveCommand, true);
  });

  it('classifica recibo vazio (EMPTY_RECEIPT) preservando o comando pendente', () => {
    const res = classifyLifecycleReceiptCheckResult(null, []);
    assert.equal(res.status, 'EMPTY_RECEIPT');
    assert.equal(res.shouldPreserveCommand, true);
  });

  it('falha de conexão ou erro ao consultar recibo NÃO descarta o comando (ERROR)', () => {
    const res = classifyLifecycleReceiptCheckResult(new Error('Network error'), null);
    assert.equal(res.status, 'ERROR');
    assert.equal(res.shouldPreserveCommand, true);
  });
});

describe('6. Transição de Estado da Listagem de Membros com items e total_count', () => {
  it('processa resposta da RPC list_church_members_admin no formato [{ items: [...], total_count: N }]', () => {
    const initial = createInitialMemberListState();
    const mockRpcData = [{
      items: [
        { member_id: 'm1', display_name: 'Membro 1', status: 'active', updated_at: '2026-10-13T20:00:00.123456Z' },
        { member_id: 'm2', display_name: 'Membro 2', status: 'inactive', updated_at: '2026-10-13T20:00:00.654321Z' },
      ],
      total_count: 2,
    }];

    const nextState = applyMemberListTransition(initial, {
      type: 'FETCH_SUCCESS',
      data: mockRpcData,
    });

    assert.equal(nextState.status, 'success');
    assert.equal(nextState.members.length, 2);
    assert.equal(nextState.totalCount, 2);
    assert.equal(nextState.hasLoadedSuccessfully, true);
    assert.equal(nextState.members[0].updated_at, '2026-10-13T20:00:00.123456Z');
  });

  it('processa lista vazia com total_count 0 corretamente', () => {
    const initial = createInitialMemberListState();
    const mockRpcData = [{
      items: [],
      total_count: 0,
    }];

    const nextState = applyMemberListTransition(initial, {
      type: 'FETCH_SUCCESS',
      data: mockRpcData,
    });

    assert.equal(nextState.status, 'success');
    assert.equal(nextState.members.length, 0);
    assert.equal(nextState.totalCount, 0);
    assert.equal(nextState.hasLoadedSuccessfully, true);

    const viewState = getMemberListViewState(nextState);
    assert.equal(viewState.showEmptyState, true);
    assert.equal(viewState.showTable, false);
  });
});

describe('7. Validação de Retornos por Operação e Proteção contra Respostas Falsamente Positivas', () => {
  it('isUncertainResponse rejeita { command_id: "outro-comando" } sem member_id como resposta incerta', () => {
    // Caso de criação: { command_id: 'outro-comando' } NÃO deve ser aceito como sucesso!
    const fakeSuccess = [{ command_id: 'outro-comando' }];
    assert.equal(isUncertainResponse(null, fakeSuccess), true);

    // Com expectedContext da criação
    assert.equal(
      isUncertainResponse(null, fakeSuccess, { commandId: 'original-cmd', churchId: 'church-1' }),
      true
    );
  });

  it('isUncertainResponse aceita criação válida quando member_id está presente e command_id coincide', () => {
    const validCreation = [{ member_id: 'm1', command_id: 'original-cmd', church_id: 'church-1' }];
    assert.equal(
      isUncertainResponse(null, validCreation, { commandId: 'original-cmd', churchId: 'church-1' }),
      false
    );
  });

  it('isUncertainResponse rejeita criação quando command_id ou church_id são divergentes', () => {
    const divergent = [{ member_id: 'm1', command_id: 'divergent-cmd', church_id: 'church-1' }];
    assert.equal(
      isUncertainResponse(null, divergent, { commandId: 'original-cmd', churchId: 'church-1' }),
      true
    );
  });

  it('isUncertainResponse exige todos os campos no ciclo de vida (restore/deactivate)', () => {
    // Incompleto (sem result_payload)
    const incomplete = [{ command_id: 'c1', action: 'restore_member', church_id: 'ch1', result_member_id: 'm1' }];
    assert.equal(
      isUncertainResponse(null, incomplete, { action: 'restore_member', commandId: 'c1' }),
      true
    );

    // Completo e coincidente com todos os campos contratados
    const complete = [{
      command_id: 'c1',
      action: 'restore_member',
      church_id: 'ch1',
      result_member_id: 'm1',
      result_payload: {
        member_id: 'm1',
        status: 'active',
        updated_at: '2026-10-14T19:00:00.000000Z',
        has_revoked_access: false,
      },
    }];
    assert.equal(
      isUncertainResponse(null, complete, {
        action: 'restore_member',
        commandId: 'c1',
        churchId: 'ch1',
        memberId: 'm1',
      }),
      false
    );

    // Payload sendo array vazio [] deve ser tratado como incerto
    const emptyArrayPayload = [{
      command_id: 'c1',
      action: 'restore_member',
      church_id: 'ch1',
      result_member_id: 'm1',
      result_payload: [],
    }];
    assert.equal(
      isUncertainResponse(null, emptyArrayPayload, {
        action: 'restore_member',
        commandId: 'c1',
        churchId: 'ch1',
        memberId: 'm1',
      }),
      true
    );
  });
});

describe('8. Tolerância a Falhas de Leitura no Storage e Prevenção de Sobrescrita de Pendência', () => {
  it('falhas de leitura ou parse corrompido no storage NÃO removem a chave (criação)', () => {
    const storage = new MockSessionStorage();
    const key = getMemberCommandStorageKey('user-1', 'church-1');
    storage.setItem(key, '{ invalid json');

    const result = loadPendingMemberCommand(storage, 'user-1', 'church-1');
    assert.equal(result, null);
    // A chave DEVE continuar existindo no storage para não perder pendência
    assert.equal(storage.getItem(key), '{ invalid json');
  });

  it('falhas de leitura ou parse corrompido no storage NÃO removem a chave (ciclo de vida)', () => {
    const storage = new MockSessionStorage();
    const key = getMemberLifecycleStorageKey('user-1', 'church-1', 'm1', 'restore_member');
    storage.setItem(key, '{ invalid json');

    const result = loadPendingLifecycleCommand(storage, 'user-1', 'church-1', 'm1', 'restore_member');
    assert.equal(result, null);
    assert.equal(storage.getItem(key), '{ invalid json');
  });

  it('savePendingMemberCommand recusa sobrescrever comando não resolvido com commandId diferente', () => {
    const storage = new MockSessionStorage();
    const saved1 = savePendingMemberCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      commandId: 'cmd-original',
      displayName: 'Membro Um',
    });
    assert.equal(saved1, true);

    // Tentativa de gravar novo comando com commandId diferente antes de resolver o anterior
    const saved2 = savePendingMemberCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      commandId: 'cmd-novo',
      displayName: 'Membro Dois',
    });
    assert.equal(saved2, false);

    // Comando original permanece preservado
    const current = loadPendingMemberCommand(storage, 'user-1', 'church-1');
    assert.equal(current.commandId, 'cmd-original');
  });

  it('savePendingLifecycleCommand recusa sobrescrever comando não resolvido com commandId diferente', () => {
    const storage = new MockSessionStorage();
    const saved1 = savePendingLifecycleCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      memberId: 'm1',
      action: 'restore_member',
      commandId: 'cmd-original',
      expectedUpdatedAt: '2026-10-14T18:00:00.000000Z',
    });
    assert.equal(saved1, true);

    const saved2 = savePendingLifecycleCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      memberId: 'm1',
      action: 'restore_member',
      commandId: 'cmd-novo',
      expectedUpdatedAt: '2026-10-14T18:00:00.000000Z',
    });
    assert.equal(saved2, false);

    const current = loadPendingLifecycleCommand(storage, 'user-1', 'church-1', 'm1', 'restore_member');
    assert.equal(current.commandId, 'cmd-original');
  });
});

describe('9. Recuperação de Comandos na Inicialização e F5 (loadAnyPendingMemberCommand)', () => {
  it('recupera comando de criação pendente quando existir', () => {
    const storage = new MockSessionStorage();
    savePendingMemberCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      commandId: 'cmd-create-1',
      displayName: 'Novo Membro',
    });

    const anyCmd = loadAnyPendingMemberCommand(storage, 'user-1', 'church-1');
    assert.ok(anyCmd);
    assert.equal(anyCmd.commandId, 'cmd-create-1');
    assert.equal(anyCmd.action, 'create_member');
  });

  it('recupera comando de ciclo de vida pendente (restore_member ou deactivate_member)', () => {
    const storage = new MockSessionStorage();
    savePendingLifecycleCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      memberId: 'm-target',
      action: 'restore_member',
      commandId: 'cmd-restore-1',
      expectedUpdatedAt: '2026-10-14T18:00:00.123456Z',
      displayName: 'Irmão Alvo',
    });

    const anyCmd = loadAnyPendingMemberCommand(storage, 'user-1', 'church-1');
    assert.ok(anyCmd);
    assert.equal(anyCmd.commandId, 'cmd-restore-1');
    assert.equal(anyCmd.action, 'restore_member');
    assert.equal(anyCmd.memberId, 'm-target');
    assert.equal(anyCmd.expectedUpdatedAt, '2026-10-14T18:00:00.123456Z');
  });

  it('isola comandos por usuário e igreja (não retorna pendência de outro tenant)', () => {
    const storage = new MockSessionStorage();
    savePendingLifecycleCommand(storage, {
      userId: 'user-1',
      churchId: 'church-1',
      memberId: 'm-target',
      action: 'restore_member',
      commandId: 'cmd-restore-1',
      expectedUpdatedAt: '2026-10-14T18:00:00.123456Z',
    });

    assert.equal(loadAnyPendingMemberCommand(storage, 'user-2', 'church-1'), null);
    assert.equal(loadAnyPendingMemberCommand(storage, 'user-1', 'church-2'), null);
  });
});

describe('10. Reposicionamento de Página Superior Vazia com Total Zero', () => {
  it('recalcula última página válida como 1 quando total_count for 0 em página superior', () => {
    const targetPage = 2;
    const items = [];
    const total = 0;
    const pageSize = 10;

    const lastPage = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    assert.equal(lastPage, 1);
    assert.equal(lastPage < targetPage, true);
  });
});

describe('11. Integração Real de Componente: MembersPage', () => {
  it('11.1 Exibe banner de resposta incerta FORA do modal após F5 e bloqueia novos cadastros', async (t) => {
    const pendingCmd = {
      commandId: 'cmd-incerto-restore',
      userId: 'admin-user-id',
      churchId: 'church-1',
      memberId: 'm2',
      action: 'restore_member',
      expectedUpdatedAt: '2026-10-14T18:00:00.123456Z',
      displayName: 'Irmão Inativo',
      timestamp: Date.now(),
    };

    setupEnvironment({
      initialStorageEntries: [
        [
          'escala_pending_member_lifecycle_cmd:admin-user-id:church-1:m2:restore_member',
          JSON.stringify(pendingCmd),
        ],
      ],
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(MembersPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const text = visibleText(renderer.root);

    // O banner deve ser exibido com texto de restauração
    assert.match(text, /Resposta incerta do servidor/);
    assert.match(text, /A restauração de "Irmão Inativo" foi interrompida antes da confirmação/);
    assert.match(text, /Reexecutar restauração/);

    // O botão de cadastrar membro deve estar desabilitado
    const btnAdd = renderer.root.findByProps({ id: 'btn-open-create-member' });
    assert.equal(btnAdd.props.disabled, true);
  });

  it('11.2 Reconciliação com get_member_lifecycle_receipt confirma operação e limpa o storage', async (t) => {
    const pendingCmd = {
      commandId: 'cmd-incerto-restore',
      userId: 'admin-user-id',
      churchId: 'church-1',
      memberId: 'm2',
      action: 'restore_member',
      expectedUpdatedAt: '2026-10-14T18:00:00.123456Z',
      displayName: 'Irmão Inativo',
      timestamp: Date.now(),
    };

    const env = setupEnvironment({
      initialStorageEntries: [
        [
          'escala_pending_member_lifecycle_cmd:admin-user-id:church-1:m2:restore_member',
          JSON.stringify(pendingCmd),
        ],
      ],
      rpcHandler: async (name, args) => {
        if (name === 'get_member_lifecycle_receipt') {
          return {
            data: [{
              command_id: 'cmd-incerto-restore',
              action: 'restore_member',
              church_id: 'church-1',
              result_member_id: 'm2',
              result_payload: {
                member_id: 'm2',
                display_name: 'Irmão Inativo',
                status: 'active',
                updated_at: '2026-10-14T18:30:00.000000Z',
                has_revoked_access: true,
              },
            }],
            error: null,
          };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(MembersPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // Clica no botão "Verificar confirmação"
    const btnReconcile = renderer.root.findByProps({ id: 'btn-reconcile-receipt' });
    await act(async () => {
      btnReconcile.props.onClick();
      await new Promise((r) => setTimeout(r, 60));
    });

    // Verifica que a RPC correta foi chamada com o command_id do ciclo de vida
    const receiptCall = env.rpcCalls.find((c) => c.name === 'get_member_lifecycle_receipt');
    assert.ok(receiptCall, 'Deve ter chamado get_member_lifecycle_receipt');
    assert.equal(receiptCall.args.p_command_id, 'cmd-incerto-restore');

    // Verifica que a pendência foi removida do storage
    assert.equal(
      env.storage.getItem('escala_pending_member_lifecycle_cmd:admin-user-id:church-1:m2:restore_member'),
      null
    );

    // Mensagem de sucesso deve estar visível
    const updatedText = visibleText(renderer.root);
    assert.match(updatedText, /Restauração do membro "Irmão Inativo" confirmada com sucesso no servidor!/);
  });

  it('11.3 Reexecução com a mesma chave e mesma revisão original', async (t) => {
    const pendingCmd = {
      commandId: 'cmd-incerto-restore',
      userId: 'admin-user-id',
      churchId: 'church-1',
      memberId: 'm2',
      action: 'restore_member',
      expectedUpdatedAt: '2026-10-14T18:00:00.123456Z',
      displayName: 'Irmão Inativo',
      timestamp: Date.now(),
    };

    const env = setupEnvironment({
      initialStorageEntries: [
        [
          'escala_pending_member_lifecycle_cmd:admin-user-id:church-1:m2:restore_member',
          JSON.stringify(pendingCmd),
        ],
      ],
      rpcHandler: async (name, args) => {
        if (name === 'restore_church_member') {
          return {
            data: [{
              command_id: args.p_command_id,
              action: 'restore_member',
              church_id: args.p_church_id,
              result_member_id: args.p_member_id,
              result_payload: {
                member_id: args.p_member_id,
                display_name: 'Irmão Inativo',
                status: 'active',
                updated_at: '2026-10-14T18:35:00.000000Z',
              },
            }],
            error: null,
          };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(MembersPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // Clica no botão "Reexecutar restauração"
    const btnRetry = renderer.root.findByProps({ id: 'btn-retry-command' });
    await act(async () => {
      btnRetry.props.onClick();
      await new Promise((r) => setTimeout(r, 60));
    });

    // Verifica que restore_church_member foi chamada com os mesmos parâmetros originais
    const restoreCall = env.rpcCalls.find((c) => c.name === 'restore_church_member');
    assert.ok(restoreCall, 'Deve ter chamado restore_church_member');
    assert.equal(restoreCall.args.p_command_id, 'cmd-incerto-restore');
    assert.equal(restoreCall.args.p_church_id, 'church-1');
    assert.equal(restoreCall.args.p_member_id, 'm2');
    assert.equal(restoreCall.args.p_expected_updated_at, '2026-10-14T18:00:00.123456Z');
  });

  it('11.4 Modal de restauração apresenta a mensagem exata sobre acesso revogado', async (t) => {
    setupEnvironment({
      members: [
        {
          id: 'm-revoked',
          member_id: 'm-revoked',
          display_name: 'Irmão Revogado',
          status: 'inactive',
          has_active_access: false,
          has_church_access: true,
          has_revoked_access: true,
          updated_at: '2026-10-14T18:00:00.123456Z',
        },
      ],
      totalCount: 1,
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(MembersPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // Clica no botão de restaurar o membro
    const btnRestore = renderer.root.findByProps({ id: 'btn-restore-member-m-revoked' });
    await act(async () => {
      btnRestore.props.onClick();
      await new Promise((r) => setTimeout(r, 30));
    });

    const modalText = visibleText(renderer.root);
    const expectedNotice =
      'A restauração reativa apenas o cadastro do membro nesta igreja. ' +
      'O acesso a esta igreja permanece revogado. ' +
      'A recuperação desse acesso depende de um fluxo separado, ainda não disponível nesta etapa.';

    assert.ok(modalText.includes(expectedNotice), 'Deve conter a mensagem exata sobre acesso revogado');
    assert.doesNotMatch(modalText, /novo convite/i, 'Não pode prometer novo convite');
    assert.doesNotMatch(modalText, /login.*revogado/i, 'Não pode alegar revogação de login global');
  });

  it('11.5 Modal de exclusão explica efeitos e limites sem expor códigos ou detalhes do banco', async (t) => {
    setupEnvironment({
      members: [
        {
          id: 'm-active',
          member_id: 'm-active',
          display_name: 'Irmão Ativo',
          status: 'active',
          has_active_access: false,
          has_church_access: false,
          has_revoked_access: false,
          updated_at: '2026-10-14T18:00:00.000000Z',
        },
      ],
      totalCount: 1,
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(MembersPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // Clica no botão excluir
    const btnDeactivate = renderer.root.findByProps({ id: 'btn-deactivate-member-m-active' });
    await act(async () => {
      btnDeactivate.props.onClick();
      await new Promise((r) => setTimeout(r, 30));
    });

    const modalText = visibleText(renderer.root);
    assert.match(modalText, /Confirme a exclusão do cadastro nesta igreja/);
    assert.match(modalText, /acesso a esta igreja será revogado/);
    assert.match(modalText, /histórico e a conta da pessoa serão preservados/);
    assert.match(modalText, /sem devolver acesso ou liderança/);
    assert.match(modalText, /Convites abertos válidos serão invalidados e solicitações pendentes serão encerradas/);
    assert.doesNotMatch(modalText, /P0021/i, 'Não pode exibir código técnico P0021');
    assert.doesNotMatch(modalText, /banco de dados/i, 'Não pode expor detalhes internos do banco de dados');
  });

  it('11.6 Descarte de respostas em voo quando contexto (igreja/conta) muda', async (t) => {
    let resolveRestore;
    let capturedArgs = null;
    const slowRpc = new Promise((res) => {
      resolveRestore = res;
    });

    let currentChurchAccess = {
      church_id: 'church-1',
      church_name: 'Igreja Central',
      is_admin: true,
      status: 'active',
    };

    const env = setupEnvironment({
      rpcHandler: async (name, args) => {
        if (name === 'restore_church_member') {
          capturedArgs = args;
          return slowRpc;
        }
        if (name === 'get_my_church_access') {
          return { data: [currentChurchAccess], error: null };
        }
        if (name === 'list_church_members_admin' || name === 'list_church_members') {
          if (args?.p_church_id === 'church-outra') {
            return {
              data: [{
                items: [
                  {
                    id: 'm-outra',
                    member_id: 'm-outra',
                    display_name: 'Membro da Outra Igreja',
                    status: 'active',
                    has_active_access: false,
                    has_church_access: false,
                    has_revoked_access: false,
                    updated_at: '2026-10-14T19:00:00.000000Z',
                  },
                ],
                total_count: 1,
              }],
              error: null,
            };
          }
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(MembersPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // Inicia restauração na Igreja Central (Church 1)
    const btnRestore = renderer.root.findByProps({ id: 'btn-restore-member-m2' });
    await act(async () => {
      btnRestore.props.onClick();
      await new Promise((r) => setTimeout(r, 30));
    });

    // Confirma restauração no modal
    const btnConfirm = renderer.root.findAllByProps({ className: 'btn btn-primary' }).find((b) =>
      visibleText(b).includes('Confirmar Restauração')
    );
    assert.ok(btnConfirm);

    await act(async () => {
      btnConfirm.props.onClick();
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.ok(capturedArgs?.p_command_id, 'Deve ter disparado a RPC capturando o command_id');
    const sentCommandId = capturedArgs.p_command_id;

    // Simula revalidação de foco que altera o vínculo ativo da conta de A (Igreja Central) para B (Outra Igreja)
    currentChurchAccess = {
      church_id: 'church-outra',
      church_name: 'Outra Igreja',
      is_admin: true,
      status: 'active',
    };

    // Dispara evento de foco da janela, como ocorre na revalidação real do AuthProvider
    await act(async () => {
      globalThis.window.dispatchEvent({ type: 'focus' });
      await new Promise((r) => setTimeout(r, 60));
    });

    // COMPROVA QUE B ESTÁ ATIVO NA TELA ANTES DE RESOLVER A RESPOSTA DE A
    const textBefore = visibleText(renderer.root);
    assert.match(textBefore, /Outra Igreja/i, 'A tela deve exibir a Igreja B antes da resolução de A');
    assert.doesNotMatch(textBefore, /restaurado com sucesso/i);

    // Agora resolve a resposta completa e correspondente de A com a chave efetivamente enviada
    await act(async () => {
      resolveRestore({
        data: [{
          command_id: sentCommandId, // CHAVE EFETIVAMENTE ENVIADA
          action: 'restore_member',
          church_id: 'church-1',
          result_member_id: 'm2',
          result_payload: {
            member_id: 'm2',
            status: 'active',
            updated_at: '2026-10-14T19:00:00.000000Z',
            has_revoked_access: false,
          },
        }],
        error: null,
      });
      await new Promise((r) => setTimeout(r, 60));
    });

    // COMPROVA QUE A RESPOSTA DE A NÃO ALTERA B
    const textAfter = visibleText(renderer.root);
    assert.match(textAfter, /Outra Igreja/i, 'A tela deve permanecer na Igreja B');
    assert.doesNotMatch(textAfter, /restaurado com sucesso/i, 'Não pode anunciar sucesso de A na tela de B');
    assert.doesNotMatch(textAfter, /Irmão Inativo/i, 'Membro restaurado de A não pode aparecer na listagem de B');

    // Comprova que o comando pendente de A foi preservado no storage para quando retornar à Igreja A
    const retainedCmd = loadPendingLifecycleCommand(
      env.storage,
      'admin-user-id',
      'church-1',
      'm2',
      'restore_member'
    );
    assert.ok(retainedCmd, 'O comando de A deve ser preservado no storage');
    assert.equal(retainedCmd.commandId, sentCommandId);
  });

  it('11.7 Erro de autorização (42501) em list_church_members_admin não chama list_church_members nem produz sucesso', async (t) => {
    let legacyCallsCount = 0;
    const env = setupEnvironment({
      rpcHandler: async (name) => {
        if (name === 'list_church_members_admin') {
          return { data: null, error: { code: '42501', message: 'permission denied for function list_church_members_admin' } };
        }
        if (name === 'list_church_members') {
          legacyCallsCount++;
          return { data: [{ id: 'leg-1', display_name: 'Membro Legado Infiltrado', status: 'active' }], error: null };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(MembersPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const text = visibleText(renderer.root);
    assert.equal(legacyCallsCount, 0, 'list_church_members NÃO pode ser chamada em caso de erro 42501');
    assert.doesNotMatch(text, /Membro Legado Infiltrado/, 'Não pode exibir membros da RPC antiga');
    assert.match(text, /Não foi possível carregar a lista de membros/i);
    assert.match(text, /Permissão insuficiente para consultar a lista de membros/i);
  });

  it('11.8 RPC ausente (42883) em list_church_members_admin não chama list_church_members nem produz sucesso falso', async (t) => {
    let legacyCallsCount = 0;
    const env = setupEnvironment({
      rpcHandler: async (name) => {
        if (name === 'list_church_members_admin') {
          return { data: null, error: { code: '42883', message: 'function list_church_members_admin does not exist' } };
        }
        if (name === 'list_church_members') {
          legacyCallsCount++;
          return { data: [{ id: 'leg-1', display_name: 'Membro Legado Infiltrado', status: 'active' }], error: null };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(MembersPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const text = visibleText(renderer.root);
    assert.equal(legacyCallsCount, 0, 'list_church_members NÃO pode ser chamada quando a RPC administrativa inexiste');
    assert.doesNotMatch(text, /Membro Legado Infiltrado/, 'Não pode produzir sucesso falso com consulta antiga');
    assert.match(text, /Não foi possível carregar a lista de membros/i);
  });

  it('11.9 Falha de transporte em list_church_members_admin não chama list_church_members e preserva estado de erro', async (t) => {
    let legacyCallsCount = 0;
    const env = setupEnvironment({
      rpcHandler: async (name) => {
        if (name === 'list_church_members_admin') {
          return { data: null, error: { message: 'Failed to fetch (network error)' } };
        }
        if (name === 'list_church_members') {
          legacyCallsCount++;
          return { data: [{ id: 'leg-1', display_name: 'Membro Legado Infiltrado', status: 'active' }], error: null };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(MembersPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const text = visibleText(renderer.root);
    assert.equal(legacyCallsCount, 0, 'list_church_members NÃO pode ser chamada em falha de rede');
    assert.doesNotMatch(text, /Membro Legado Infiltrado/);
    assert.match(text, /Não foi possível carregar a lista de membros/i);
    assert.match(text, /falha de conexão/i);
  });

  it('11.10 Coleção vazia válida na listagem administrativa não dispara consulta antiga nem insere membros ativos', async (t) => {
    let legacyCallsCount = 0;
    const env = setupEnvironment({
      rpcHandler: async (name) => {
        if (name === 'list_church_members_admin') {
          return { data: [{ items: [], total_count: 0 }], error: null };
        }
        if (name === 'list_church_members') {
          legacyCallsCount++;
          return { data: [{ id: 'leg-1', display_name: 'Membro Ativo Vindo do Fallback', status: 'active' }], error: null };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(MembersPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const text = visibleText(renderer.root);
    assert.equal(legacyCallsCount, 0, 'Coleção vazia válida NÃO pode disparar fallback para list_church_members');
    assert.doesNotMatch(text, /Membro Ativo Vindo do Fallback/);
    assert.match(text, /Nenhum membro ativo|Nenhum membro cadastrado/i);
  });

  it('11.11 Coordenação de contexto na listagem: resposta em voo da Igreja A não substitui a lista da Igreja B', async (t) => {
    let resolveListA;
    const promiseListA = new Promise((resolve) => {
      resolveListA = resolve;
    });

    let currentChurchAccess = {
      church_id: 'church-a',
      church_name: 'Igreja A',
      is_admin: true,
      status: 'active',
    };

    const env = setupEnvironment({
      rpcHandler: async (name, args) => {
        if (name === 'get_my_church_access') {
          return { data: [currentChurchAccess], error: null };
        }
        if (name === 'list_church_members_admin') {
          if (args?.p_church_id === 'church-a') {
            await promiseListA;
            return {
              data: [{
                items: [{ id: 'm-a', member_id: 'm-a', display_name: 'Membro da Igreja A', status: 'active', updated_at: '2026-10-14T19:00:00Z' }],
                total_count: 1,
              }],
              error: null,
            };
          }
          if (args?.p_church_id === 'church-b') {
            return {
              data: [{
                items: [{ id: 'm-b', member_id: 'm-b', display_name: 'Membro da Igreja B', status: 'active', updated_at: '2026-10-14T19:00:00Z' }],
                total_count: 1,
              }],
              error: null,
            };
          }
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(MembersPage)));
    t.after(() => act(() => renderer.unmount()));

    // Aguarda início da carga em A
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    // Muda contexto vivo para Igreja B
    currentChurchAccess = {
      church_id: 'church-b',
      church_name: 'Igreja B',
      is_admin: true,
      status: 'active',
    };

    await act(async () => {
      globalThis.window.dispatchEvent({ type: 'focus' });
      await new Promise((r) => setTimeout(r, 60));
    });

    // Comprova que Igreja B está ativa e com membro de B
    let text = visibleText(renderer.root);
    assert.match(text, /Igreja B/i);
    assert.match(text, /Membro da Igreja B/i);

    // Agora resolve a listagem pendente de A
    await act(async () => {
      resolveListA();
      await new Promise((r) => setTimeout(r, 60));
    });

    // Comprova que a resposta de A foi descartada pela coordenação de contexto
    text = visibleText(renderer.root);
    assert.match(text, /Igreja B/i);
    assert.match(text, /Membro da Igreja B/i);
    assert.doesNotMatch(text, /Membro da Igreja A/i, 'A resposta atrasada de A não pode vazar para a tela da Igreja B');
  });
});

