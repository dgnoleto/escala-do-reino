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

const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'issue-81-82-planning-nome-responsavel-equipes.bundle.mjs');
await build({
  stdin: {
    contents: `
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
const { AppProvider, useApp, PlanningView } = await import(pathToFileURL(bundlePath).href);

function getNodeText(node) {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join(' ');
  if (Array.isArray(node.children)) return node.children.map(getNodeText).join(' ');
  if (node.props?.children) return getNodeText(node.props.children);
  return '';
}

function makeClient({ teamsData = null, teamsError = null, events = [] } = {}) {
  return {
    rpc: async (fn) => {
      if (fn === 'list_church_events') {
        return { data: [{ events, total_count: events.length }], error: null };
      }
      if (fn === 'list_event_types') {
        return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
      }
      if (fn === 'list_church_teams') {
        if (teamsError) return { data: null, error: teamsError };
        return { data: teamsData, error: null };
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
  activities: [],
};

describe('Issues #81 e #82 — Nome do Responsável na Liturgia e Lista Real de Equipes no Planejamento', () => {
  test('(a) #82: com RPC list_church_teams retornando [{teams:[{id:\'t-louvor\',name:\'Louvor\',leader_member_id:\'m1\'},{id:\'t-som\',name:\'Som\',leader_member_id:null}]}], abrir o modal "Adicionar Apoio Paralelo" e afirmar: select-parallel-team tem exatamente 3 options (placeholder + 2), valores \'\', \'t-louvor\', \'t-som\', textos \'Louvor\' e \'Som\'; e console.error NÃO é chamado com "unique \\"key\\""', async () => {
    const originalConsoleError = console.error;
    const errorLogs = [];
    console.error = (...args) => {
      errorLogs.push(args.join(' '));
      originalConsoleError.apply(console, args);
    };

    try {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const mockClient = makeClient({
        teamsData: [{
          teams: [
            { id: 't-louvor', name: 'Louvor', leader_member_id: 'm1' },
            { id: 't-som', name: 'Som', leader_member_id: null },
          ]
        }]
      });

      let tree;
      await act(async () => {
        tree = TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'admin-user', churchId: CHURCH_ID, supabaseClient: mockClient },
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        );
      });

      await act(async () => {
        appCtx.setEvents([baseEvent]);
      });

      assert.equal(appCtx.teamsLoadStatus, 'loaded');

      const addBtn = tree.root.findByProps({ id: 'btn-open-new-parallel-service-modal' });
      await act(async () => {
        addBtn.props.onClick();
      });

      const select = tree.root.findByProps({ id: 'select-parallel-team' });
      const options = select.findAll(n => n.type === 'option');

      assert.equal(options.length, 3, 'select-parallel-team deve ter exatamente 3 options (placeholder + 2 equipes)');
      assert.equal(options[0].props.value, '');
      assert.equal(options[1].props.value, 't-louvor');
      assert.equal(getNodeText(options[1]).trim(), 'Louvor');
      assert.equal(options[2].props.value, 't-som');
      assert.equal(getNodeText(options[2]).trim(), 'Som');

      const keyWarnings = errorLogs.filter(msg => /unique "key"/i.test(msg));
      assert.equal(keyWarnings.length, 0, 'console.error não deve receber aviso de chave única duplicada/ausente');
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('(b) #82: RPC retornando [{teams: []}] → select com só o placeholder, sem erro, status loaded', async () => {
    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const mockClient = makeClient({
      teamsData: [{ teams: [] }]
    });

    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(AppProvider, { initialUserId: 'mariana', churchId: CHURCH_ID, supabaseClient: mockClient },
          React.createElement(Consumer),
          React.createElement(PlanningView)
        )
      );
    });

    await act(async () => {
      appCtx.setEvents([baseEvent]);
    });

    assert.equal(appCtx.teamsLoadStatus, 'loaded');

    const addBtn = tree.root.findByProps({ id: 'btn-open-new-parallel-service-modal' });
    await act(async () => {
      addBtn.props.onClick();
    });

    const select = tree.root.findByProps({ id: 'select-parallel-team' });
    const options = select.findAll(n => n.type === 'option');
    assert.equal(options.length, 1, 'select-parallel-team deve ter apenas o placeholder');
    assert.equal(options[0].props.value, '');
  });

  test('(c) #82: RPC com erro → comportamento atual de falha preservado', async () => {
    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const mockClient = makeClient({
      teamsError: { message: 'Erro ao carregar equipes' }
    });

    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(AppProvider, { initialUserId: 'mariana', churchId: CHURCH_ID, supabaseClient: mockClient },
          React.createElement(Consumer),
          React.createElement(PlanningView)
        )
      );
    });

    assert.equal(appCtx.teamsLoadStatus, 'failed');
    const notice = tree.root.find(n => n.props?.id === 'notice-teams-load-status');
    assert.ok(notice, 'Aviso de falha no carregamento de equipes deve ser exibido');
    assert.match(getNodeText(notice), /Não foi possível carregar as equipes/i);
  });

  test('(d) #81: etapa com responsibleMemberId = id de membro existente → texto contém o NOME do membro e NÃO contém o UUID', async () => {
    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const MEMBER_UUID = '550e8400-e29b-41d4-a716-446655440000';
    const mockClient = makeClient({
      teamsData: [{ teams: [] }]
    });

    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(AppProvider, { initialUserId: 'mariana', churchId: CHURCH_ID, supabaseClient: mockClient },
          React.createElement(Consumer),
          React.createElement(PlanningView)
        )
      );
    });

    await act(async () => {
      appCtx.setMembers([
        { id: MEMBER_UUID, name: 'Pastor Carlos Oliveira', active: true, roles: ['membro'] },
      ]);
      appCtx.setEvents([{
        ...baseEvent,
        activities: [
          {
            id: 'act-palavra-01',
            title: 'Momento da Palavra',
            category: 'Mensagem',
            plannedDurationMinutes: 30,
            responsibleMemberId: MEMBER_UUID,
          }
        ]
      }]);
    });

    const metaNode = tree.root.find(n => n.props?.className === 'planning-act-meta');
    assert.ok(metaNode, 'Div planning-act-meta deve existir');
    const metaText = getNodeText(metaNode);
    assert.match(metaText, /Pastor Carlos Oliveira/, 'Deve conter o nome do responsável');
    assert.equal(metaText.includes(MEMBER_UUID), false, 'NÃO deve conter o UUID do responsável');
  });

  test('(e) #81: responsibleMemberId inexistente em members → exibe \'Responsável não identificado\' e NÃO exibe o UUID', async () => {
    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    const UNKNOWN_UUID = '999e8400-e29b-41d4-a716-999999999999';
    const mockClient = makeClient({
      teamsData: [{ teams: [] }]
    });

    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(AppProvider, { initialUserId: 'mariana', churchId: CHURCH_ID, supabaseClient: mockClient },
          React.createElement(Consumer),
          React.createElement(PlanningView)
        )
      );
    });

    await act(async () => {
      appCtx.setMembers([
        { id: 'other-uuid', name: 'Ana Silva', active: true, roles: ['membro'] },
      ]);
      appCtx.setEvents([{
        ...baseEvent,
        activities: [
          {
            id: 'act-palavra-02',
            title: 'Momento da Palavra',
            category: 'Mensagem',
            plannedDurationMinutes: 30,
            responsibleMemberId: UNKNOWN_UUID,
          }
        ]
      }]);
    });

    const metaNode = tree.root.find(n => n.props?.className === 'planning-act-meta');
    assert.ok(metaNode, 'Div planning-act-meta deve existir');
    const metaText = getNodeText(metaNode);
    assert.match(metaText, /Responsável não identificado/, 'Deve conter \'Responsável não identificado\'');
    assert.equal(metaText.includes(UNKNOWN_UUID), false, 'NÃO deve conter o UUID do responsável');
  });
});
