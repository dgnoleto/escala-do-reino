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
const OLD_LEADER_ID = 'm-leader-old';
const NEW_LEADER_ID = 'm-leader-new';

const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, `issue-89-admin-designation-${Date.now()}.bundle.mjs`);

await build({
  stdin: {
    contents: `
      export { AppProvider, useApp } from './src/context/AppContext.jsx';
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

const { AppProvider, useApp, AdminView } = await import(pathToFileURL(bundlePath).href);

function createMockSupabase(rpcHandler) {
  return {
    rpc: async (fn, params) => {
      if (rpcHandler) {
        return rpcHandler(fn, params);
      }
      return { data: [], error: null };
    },
  };
}

function canonicalLiturgyReceipt(params, eventId = EVENT_ID, version = 2) {
  return {
    data: [{
      command_id: params.p_command_id,
      action: 'assign_event_liturgy_leader',
      church_id: params.p_church_id,
      result_entity_id: eventId,
      result_payload: {
        id: eventId,
        event_id: eventId,
        previous_liturgy_leader_member_id: OLD_LEADER_ID,
        new_liturgy_leader_member_id: params.p_new_liturgy_leader_member_id,
        version,
      },
      created_at: '2026-11-22T14:00:00Z',
    }],
    error: null,
  };
}

const sampleEvent = {
  id: EVENT_ID,
  church_id: CHURCH_ID,
  title: 'Culto de Celebração',
  event_type: 'culto',
  timezone: 'America/Sao_Paulo',
  status: 'scheduled',
  liturgy_leader_member_id: OLD_LEADER_ID,
  liturgy_leader_name: 'Líder Antigo',
  version: 1,
  planned_start_at: '2026-11-22T19:00:00-03:00',
  planned_end_at: '2026-11-22T21:00:00-03:00',
};

const OTHER_LEADER_ID = 'm-leader-outra-aba';

function renderAdmin(mockClient, captured) {
  function Consumer() {
    captured.appCtx = useApp();
    return null;
  }
  return TestRenderer.create(
    React.createElement(AppProvider, {
      initialUserId: 'marcos',
      churchId: CHURCH_ID,
      supabaseClient: mockClient,
      allowMemoryFallback: false,
    }, React.createElement(React.Fragment, null,
      React.createElement(Consumer),
      React.createElement(AdminView, { initialTab: 'liturgy' })
    ))
  );
}

function makeClient(state, assignCalls) {
  return createMockSupabase(async (fn, params) => {
    if (fn === 'list_church_events') {
      return {
        data: [{
          events: [{
            ...sampleEvent,
            liturgy_leader_member_id: state.leader,
            liturgy_leader_name: state.leader === NEW_LEADER_ID ? 'Novo Líder' : 'Outro',
            version: state.version,
          }],
          total_count: 1,
        }],
        error: null,
      };
    }
    if (fn === 'assign_event_liturgy_leader') {
      assignCalls.push(params);
      state.leader = params.p_new_liturgy_leader_member_id;
      state.version = params.p_expected_version + 1;
      return canonicalLiturgyReceipt(params, params.p_event_id, state.version);
    }
    return { data: [], error: null };
  });
}

describe('Issue #101 — líder atual desatualizado na Designação da Liturgia', () => {

  test('(xii) Líder escolhido pelo admin e líder atual mudou depois: o primeiro salvar pede confirmação e não grava', async () => {
    const state = { leader: OLD_LEADER_ID, version: 1 };
    const assignCalls = [];
    const captured = {};
    let renderer;
    await act(async () => { renderer = renderAdmin(makeClient(state, assignCalls), captured); });

    // O administrador escolhe outro líder na tela
    await act(async () => {
      renderer.root.findByProps({ id: 'select-admin-liturgy-leader' }).props.onChange({ target: { value: NEW_LEADER_ID } });
    });

    // Outra aba grava um líder diferente; a tela recarrega os dados
    state.leader = OTHER_LEADER_ID;
    state.version = 2;
    await act(async () => { await captured.appCtx.reloadRemoteData(); });

    const saveBtn = renderer.root.findByProps({ id: 'btn-save-admin-liturgy-designation' });
    await act(async () => { await saveBtn.props.onClick(); });

    assert.equal(assignCalls.length, 0, 'O primeiro salvar não pode gravar sobre um líder que mudou');
    assert.match(JSON.stringify(renderer.toJSON()), /mudou para/i, 'Deve mostrar o aviso de líder atual alterado');
  });

  test('(xii-b) Após o aviso, um segundo salvar confirma a sobrescrita e grava com a versão atual', async () => {
    const state = { leader: OLD_LEADER_ID, version: 1 };
    const assignCalls = [];
    const captured = {};
    let renderer;
    await act(async () => { renderer = renderAdmin(makeClient(state, assignCalls), captured); });

    await act(async () => {
      renderer.root.findByProps({ id: 'select-admin-liturgy-leader' }).props.onChange({ target: { value: NEW_LEADER_ID } });
    });
    state.leader = OTHER_LEADER_ID;
    state.version = 2;
    await act(async () => { await captured.appCtx.reloadRemoteData(); });

    const saveBtn = renderer.root.findByProps({ id: 'btn-save-admin-liturgy-designation' });
    await act(async () => { await saveBtn.props.onClick(); });
    await act(async () => { await saveBtn.props.onClick(); });

    assert.equal(assignCalls.length, 1, 'Após a confirmação, deve haver uma única gravação');
    assert.equal(assignCalls[0].p_expected_version, 2, 'A gravação usa a versão atual do evento');
    assert.equal(assignCalls[0].p_new_liturgy_leader_member_id, NEW_LEADER_ID);
    assert.match(JSON.stringify(renderer.toJSON()), /atualizada com sucesso/i);
  });

  test('(xii-c) Sem escolha do admin, o seletor acompanha o líder atual e salvar grava direto (sem aviso)', async () => {
    const state = { leader: OLD_LEADER_ID, version: 1 };
    const assignCalls = [];
    const captured = {};
    let renderer;
    await act(async () => { renderer = renderAdmin(makeClient(state, assignCalls), captured); });

    state.leader = OTHER_LEADER_ID;
    state.version = 2;
    await act(async () => { await captured.appCtx.reloadRemoteData(); });

    const select = renderer.root.findByProps({ id: 'select-admin-liturgy-leader' });
    assert.equal(select.props.value, OTHER_LEADER_ID, 'O seletor deve acompanhar o líder atual quando o admin não escolheu nada');

    const saveBtn = renderer.root.findByProps({ id: 'btn-save-admin-liturgy-designation' });
    await act(async () => { await saveBtn.props.onClick(); });
    assert.equal(assignCalls.length, 1);
    assert.equal(assignCalls[0].p_expected_version, 2);
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /mudou para/i);
  });
});
