import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const CHURCH_ID = '00000000-0000-4000-8000-000000000001';

// AdminView agenda um setTimeout que usa `document` (foco de aba); no Node isso não existe.
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { getElementById: () => null };
}

const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'issue-90-aba-convites-ambiente-real.bundle.mjs');
await build({
  stdin: {
    contents: `
      export { AppProvider, useApp } from './src/context/AppContext.jsx';
      export { AuthContext } from './src/context/AuthContext.jsx';
      export { default as AdminView } from './src/components/AdminView.jsx';
    `,
    resolveDir: process.cwd(),
    loader: 'jsx',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  external: ['react', 'react-dom', 'lucide-react', '@supabase/supabase-js'],
  jsx: 'automatic',
});
const { AppProvider, useApp, AdminView, AuthContext } = await import(pathToFileURL(bundlePath).href);

function allText(node) {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(allText).join(' ');
  if (node.children) return allText(node.children);
  return '';
}

function hostById(tree, id) {
  return tree.root.findAll(n => typeof n.type === 'string' && n.props.id === id);
}

function tablist(tree) {
  return tree.root.find(n => typeof n.type === 'string' && n.props.role === 'tablist');
}

function emptyClient() {
  return { rpc: async () => ({ data: [], error: null }) };
}

async function mountAdmin({ real, initialTab } = {}) {
  const ctx = { current: null };
  function Consumer() {
    ctx.current = useApp();
    return null;
  }
  const providerProps = real
    ? { churchId: CHURCH_ID, supabaseClient: emptyClient(), allowMemoryFallback: false }
    : { initialUserId: 'marcos', allowMemoryFallback: true };
  const adminProps = initialTab ? { initialTab } : {};
  const authValue = real
    ? { churchAccess: { church_id: CHURCH_ID, is_admin: true } }
    : null;

  let tree;
  await act(async () => {
    tree = TestRenderer.create(
      React.createElement(AuthContext.Provider, { value: authValue },
        React.createElement(AppProvider, providerProps,
          React.createElement(Consumer),
          React.createElement(AdminView, adminProps)
        )
      )
    );
  });
  return { tree, ctx };
}

describe('Issue #90 — Aba Convites de Acesso local não aparece no ambiente real', () => {
  test('(i) real: botão tab-admin-invites não existe e o título da aba não aparece', async () => {
    const { tree } = await mountAdmin({ real: true });

    assert.equal(hostById(tree, 'tab-admin-event-types').length, 1, 'aba Tipos de Evento deve existir');
    assert.equal(hostById(tree, 'tab-admin-invites').length, 0, 'tab-admin-invites não deve existir no real');
    assert.ok(
      !allText(tree.toJSON()).includes('Convites de Acesso à Igreja'),
      'o texto "Convites de Acesso à Igreja" não deve aparecer no real'
    );
  });

  test('(ii) real com initialTab "invites": aba ativa é event_types e panel-admin-invites não existe', async () => {
    const { tree } = await mountAdmin({ real: true, initialTab: 'invites' });

    const activeTab = hostById(tree, 'tab-admin-event-types')[0];
    assert.equal(activeTab.props['aria-selected'], true, 'event_types deve ser a aba ativa');
    assert.equal(hostById(tree, 'panel-admin-invites').length, 0, 'panel-admin-invites não deve renderizar no real');
  });

  test('(iii) real, teclado: ArrowRight a partir de reasons vai para liturgy (pula invites); ArrowLeft volta para reasons', async () => {
    const { tree } = await mountAdmin({ real: true });

    await act(async () => {
      hostById(tree, 'tab-admin-reasons')[0].props.onClick();
    });
    assert.equal(hostById(tree, 'tab-admin-reasons')[0].props['aria-selected'], true);

    await act(async () => {
      tablist(tree).props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
    });
    assert.equal(hostById(tree, 'tab-admin-liturgy')[0].props['aria-selected'], true, 'ArrowRight deve ir para liturgy');

    await act(async () => {
      tablist(tree).props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} });
    });
    assert.equal(hostById(tree, 'tab-admin-reasons')[0].props['aria-selected'], true, 'ArrowLeft deve voltar para reasons');
  });

  test('(iv) real: sendAccessInvite retorna success:false, não grava accessInvites nem auditLogs', async () => {
    const { ctx } = await mountAdmin({ real: true });
    const auditBefore = ctx.current.auditLogs.length;

    let result;
    await act(async () => {
      result = ctx.current.sendAccessInvite('ana@example.com', 'Ana');
    });

    assert.equal(result?.success, false, 'deve falhar fechado no real');
    assert.match(result?.error || '', /Convite local indisponível no ambiente real/);
    assert.equal(ctx.current.accessInvites.length, 0, 'accessInvites deve continuar vazio');
    assert.equal(ctx.current.auditLogs.length, auditBefore, 'nenhum registro novo em auditLogs');
  });

  test('(v) não real: tab-admin-invites existe e o envio local continua funcionando', async () => {
    const { tree, ctx } = await mountAdmin({ real: false });

    assert.equal(hostById(tree, 'tab-admin-invites').length, 1, 'tab-admin-invites deve existir fora do real');

    // Fora do real, accessInvites começa com dados de demonstração (INITIAL_ACCESS_INVITES): medir o acréscimo.
    const invitesBefore = ctx.current.accessInvites.length;
    let result;
    await act(async () => {
      result = ctx.current.sendAccessInvite('ana@example.com', 'Ana');
    });

    assert.equal(result?.success, true, 'envio no não real deve retornar success:true');
    assert.equal(ctx.current.accessInvites.length, invitesBefore + 1, 'convite deve ser adicionado no não real');
    assert.equal(ctx.current.accessInvites[0].email, 'ana@example.com');
  });
});
