import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const CHURCH_ID = '00000000-0000-4000-8000-000000000001';
const EVENT_ID = '00000000-0000-4000-8000-000000000099';
const RESP_MEMBER_ID = '00000000-0000-4000-8000-000000000055';
const RESP_MEMBER_NAME = 'Irmão Barnabé';

const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, `issue-88-members-planning-${Date.now()}.bundle.mjs`);

await build({
  stdin: {
    contents: `
      export { AuthContext } from './src/context/AuthContext.jsx';
      export { AppProvider, useApp } from './src/context/AppContext.jsx';
      export { default as PlanningView } from './src/components/PlanningView.jsx';
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

const { AuthContext, AppProvider, useApp, PlanningView } = await import(pathToFileURL(bundlePath).href);

function getNodeText(node) {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join(' ');
  if (Array.isArray(node.children)) return node.children.map(getNodeText).join(' ');
  if (node.props?.children) return getNodeText(node.props.children);
  return '';
}

function makeClient(rpcHandler) {
  return {
    rpc: async (fn, params) => {
      if (rpcHandler) {
        const handled = await rpcHandler(fn, params);
        if (handled !== undefined) return handled;
      }
      if (fn === 'list_church_events') {
        return { data: [{ events: [baseEvent], total_count: 1 }], error: null };
      }
      if (fn === 'list_event_types') {
        return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
      }
      if (fn === 'list_church_teams') {
        return { data: [{ teams: [] }], error: null };
      }
      return { data: [], error: null };
    },
  };
}

const baseEvent = {
  id: EVENT_ID,
  church_id: CHURCH_ID,
  title: 'Culto de Celebração',
  status: 'scheduled',
  programStatus: 'draft',
  durationPolicy: 'warn',
  plannedStartAt: '2026-11-22T19:00:00-03:00',
  plannedEndAt: '2026-11-22T21:00:00-03:00',
  activitiesKnownInSession: true,
  parallelServices: [],
  activities: [
    {
      id: 'act-1',
      title: 'Boas-vindas e Oração Inicial',
      category: 'Liturgia',
      plannedDurationMinutes: 10,
      responsibleMemberId: RESP_MEMBER_ID,
      musics: [],
    },
  ],
};

describe('Issue #88 — Carga de Nomes de Membros para Não-Admin e Visibilidade de Falha', () => {

  test('(i) não-admin: chama list_church_members_for_team e NÃO chama list_church_members', async () => {
    const calledRpcs = [];
    const mockClient = makeClient((fn, params) => {
      calledRpcs.push({ fn, params });
      if (fn === 'list_church_members_for_team') {
        return { data: [{ members: [{ member_id: RESP_MEMBER_ID, display_name: RESP_MEMBER_NAME }] }], error: null };
      }
      return undefined;
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const authVal = {
      churchAccess: { church_id: CHURCH_ID, is_admin: false, member_id: 'm-leader', display_name: 'Líder' },
    };

    await act(async () => {
      TestRenderer.create(
        React.createElement(AuthContext.Provider, { value: authVal },
          React.createElement(AppProvider, { churchId: CHURCH_ID, supabaseClient: mockClient, allowMemoryFallback: false },
            React.createElement(Consumer)
          )
        )
      );
    });

    assert.ok(calledRpcs.some(c => c.fn === 'list_church_members_for_team'), 'Deve chamar list_church_members_for_team');
    assert.ok(!calledRpcs.some(c => c.fn === 'list_church_members'), 'NÃO deve chamar list_church_members');
  });

  test('(ii) wrapper [{ members: [{member_id, display_name}] }] é desembrulhado e o nome aparece na etapa (sem UUID)', async () => {
    const mockClient = makeClient((fn) => {
      if (fn === 'list_church_members_for_team') {
        return {
          data: [{
            members: [
              { member_id: RESP_MEMBER_ID, display_name: RESP_MEMBER_NAME },
            ],
          }],
          error: null,
        };
      }
      return undefined;
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const authVal = {
      churchAccess: { church_id: CHURCH_ID, is_admin: false },
    };

    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(AuthContext.Provider, { value: authVal },
          React.createElement(AppProvider, { churchId: CHURCH_ID, supabaseClient: mockClient, allowMemoryFallback: false },
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        )
      );
    });

    await act(async () => {
      appCtx.setEvents([baseEvent]);
      appCtx.selectEvent(EVENT_ID);
    });

    assert.equal(appCtx.membersLoadStatus, 'loaded');
    const allText = getNodeText(tree.toJSON());
    assert.ok(allText.includes(RESP_MEMBER_NAME), `Deveria conter '${RESP_MEMBER_NAME}'`);
    assert.ok(!allText.includes(RESP_MEMBER_ID), `NÃO deveria conter o UUID '${RESP_MEMBER_ID}'`);
  });

  test('(iii) não-admin com 42501: membersLoadStatus "failed", aviso visível na tela, "Responsável não identificado" e nenhum UUID', async () => {
    const mockClient = makeClient((fn) => {
      if (fn === 'list_church_members_for_team') {
        return {
          data: null,
          error: { code: '42501', message: 'Apenas administradores ou líderes de equipe ativos podem consultar esta listagem.' },
        };
      }
      return undefined;
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const authVal = {
      churchAccess: { church_id: CHURCH_ID, is_admin: false },
    };

    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(AuthContext.Provider, { value: authVal },
          React.createElement(AppProvider, { churchId: CHURCH_ID, supabaseClient: mockClient, allowMemoryFallback: false },
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        )
      );
    });

    await act(async () => {
      appCtx.setEvents([baseEvent]);
      appCtx.selectEvent(EVENT_ID);
    });

    assert.equal(appCtx.membersLoadStatus, 'failed', 'membersLoadStatus deve ser failed em 42501');

    const noticeNode = tree.root.findByProps({ id: 'notice-members-load-failed' });
    assert.ok(noticeNode, 'Aviso notice-members-load-failed deve estar visível');
    const noticeText = getNodeText(noticeNode);
    assert.ok(noticeText.includes("Não foi possível carregar os nomes dos membros. Responsáveis podem aparecer como 'Responsável não identificado'."));

    const allText = getNodeText(tree.toJSON());
    assert.ok(allText.includes('Responsável não identificado'), 'Deve exibir fallback Responsável não identificado');
    assert.ok(!allText.includes(RESP_MEMBER_ID), 'NÃO pode exibir UUID');
  });

  test('(iv) admin: continua chamando list_church_members e NÃO chama list_church_members_for_team', async () => {
    const calledRpcs = [];
    const mockClient = makeClient((fn, params) => {
      calledRpcs.push({ fn, params });
      if (fn === 'list_church_members') {
        return { data: [{ member_id: RESP_MEMBER_ID, display_name: RESP_MEMBER_NAME, status: 'active' }], error: null };
      }
      return undefined;
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const authVal = {
      churchAccess: { church_id: CHURCH_ID, is_admin: true, member_id: 'm-admin', display_name: 'Admin' },
    };

    await act(async () => {
      TestRenderer.create(
        React.createElement(AuthContext.Provider, { value: authVal },
          React.createElement(AppProvider, { churchId: CHURCH_ID, supabaseClient: mockClient, allowMemoryFallback: false },
            React.createElement(Consumer)
          )
        )
      );
    });

    assert.ok(calledRpcs.some(c => c.fn === 'list_church_members'), 'Admin deve chamar list_church_members');
    assert.ok(!calledRpcs.some(c => c.fn === 'list_church_members_for_team'), 'Admin NÃO deve chamar list_church_members_for_team');
    assert.equal(appCtx.membersLoadStatus, 'loaded');
  });

  test('(v) admin com erro em list_church_members: "failed" e aviso visível', async () => {
    const mockClient = makeClient((fn) => {
      if (fn === 'list_church_members') {
        return { data: null, error: { code: '500', message: 'Internal Server Error' } };
      }
      return undefined;
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const authVal = {
      churchAccess: { church_id: CHURCH_ID, is_admin: true },
    };

    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(AuthContext.Provider, { value: authVal },
          React.createElement(AppProvider, { churchId: CHURCH_ID, supabaseClient: mockClient, allowMemoryFallback: false },
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        )
      );
    });

    assert.equal(appCtx.membersLoadStatus, 'failed');
    const noticeNode = tree.root.findByProps({ id: 'notice-members-load-failed' });
    assert.ok(noticeNode, 'Aviso de falha de membros deve estar visível');
  });

  test('(vi) lista vazia de não-admin: "loaded", sem aviso', async () => {
    const mockClient = makeClient((fn) => {
      if (fn === 'list_church_members_for_team') {
        return { data: [{ members: [] }], error: null };
      }
      return undefined;
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const authVal = {
      churchAccess: { church_id: CHURCH_ID, is_admin: false },
    };

    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(AuthContext.Provider, { value: authVal },
          React.createElement(AppProvider, { churchId: CHURCH_ID, supabaseClient: mockClient, allowMemoryFallback: false },
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        )
      );
    });

    assert.equal(appCtx.membersLoadStatus, 'loaded');
    assert.throws(
      () => tree.root.findByProps({ id: 'notice-members-load-failed' }),
      /No instances found with props/
    );
  });

  test('(vii) formato inválido (sem members): "failed"', async () => {
    const mockClient = makeClient((fn) => {
      if (fn === 'list_church_members_for_team') {
        return { data: [{ invalid_field: 123 }], error: null };
      }
      return undefined;
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const authVal = {
      churchAccess: { church_id: CHURCH_ID, is_admin: false },
    };

    await act(async () => {
      TestRenderer.create(
        React.createElement(AuthContext.Provider, { value: authVal },
          React.createElement(AppProvider, { churchId: CHURCH_ID, supabaseClient: mockClient, allowMemoryFallback: false },
            React.createElement(Consumer)
          )
        )
      );
    });

    assert.equal(appCtx.membersLoadStatus, 'failed');
  });

  test('(viii) não-admin: seletor de responsável da etapa exibe nome limpo sem parênteses vazios quando teams está vazio', async () => {
    const mockClient = makeClient((fn) => {
      if (fn === 'list_church_members_for_team') {
        return {
          data: [{ members: [{ member_id: RESP_MEMBER_ID, display_name: RESP_MEMBER_NAME }] }],
          error: null,
        };
      }
      return undefined;
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const authVal = {
      churchAccess: { church_id: CHURCH_ID, is_admin: false, member_id: 'm-leader', display_name: 'Líder' },
    };

    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(AuthContext.Provider, { value: authVal },
          React.createElement(AppProvider, { churchId: CHURCH_ID, supabaseClient: mockClient, allowMemoryFallback: false },
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        )
      );
    });

    await act(async () => {
      appCtx.setEvents([{ ...baseEvent, liturgyLeaderId: 'm-leader' }]);
      appCtx.selectEvent(EVENT_ID);
    });

    assert.equal(appCtx.membersLoadStatus, 'loaded');

    const openBtn = tree.root.findByProps({ id: 'btn-open-new-activity-modal' });
    await act(async () => {
      openBtn.props.onClick();
    });

    const opt = tree.root.find(n => n.type === 'option' && n.props?.value === RESP_MEMBER_ID);
    assert.ok(opt, 'Deveria encontrar a option do membro');
    assert.equal(getNodeText(opt), 'Irmão Barnabé');
  });

});
