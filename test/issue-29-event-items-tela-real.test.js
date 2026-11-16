import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {
  buildLiturgicalItemDrafts,
  buildEventItemDraftKey,
  saveEventItemsSequentially,
  toPersistedActivities,
  canAppendEventItemsToEvent,
  getAppendEventItemsBlockReason,
  UNKNOWN_SERVER_ITEMS_BLOCK_REASON,
  UNCERTAIN_EVENT_ITEMS_BLOCK_REASON,
} from '../src/utils/eventItemService.js';
import { toPlanningEventFromServer } from '../src/utils/eventPlanningService.js';
import { instantiateServiceTemplateRemote } from '../src/utils/serviceTemplateService.js';

const CHURCH_ID = '00000000-0000-4000-8000-000000000001';
const EVENT_ID = '00000000-0000-4000-8000-000000000099';
const TEMPLATE_ID = '00000000-0000-4000-8000-000000000077';

// Bundle JSX para testes integrados com AppContext
const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'issue-29-context.bundle.mjs');
await build({
  stdin: {
    contents: `export { AppProvider, useApp } from './src/context/AppContext.jsx';`,
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
const { AppProvider, useApp } = await import(pathToFileURL(bundlePath).href);

describe('Issue #29 — Persistência Sequencial de Etapas Litúrgicas, Bloqueios e Modelo do Servidor', () => {
  test('grava etapas sequencialmente com um command_id por etapa e substitui id local pelo result_entity_id', async () => {
    const drafts = buildLiturgicalItemDrafts([
      { id: 'act-local-1', title: 'Abertura', plannedDurationMinutes: 10 },
      { id: 'act-local-2', title: 'Louvor', plannedDurationMinutes: 25 },
      { id: 'act-local-3', title: 'Palavra', plannedDurationMinutes: 40 },
    ], 0);

    let seq = 0;
    const sent = [];
    const outcome = await saveEventItemsSequentially({
      supabase: {},
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      drafts,
      pendingCommandIds: new Map(),
      generateId: () => `cmd-${++seq}`,
      createItem: async (params) => {
        sent.push(params);
        return {
          status: 'SUCCESS',
          receipt: { result_entity_id: `srv-item-${params.sequenceOrder}` },
        };
      },
    });

    assert.equal(outcome.failed, null);
    assert.equal(outcome.notAttempted.length, 0);
    assert.equal(outcome.saved.length, 3);
    assert.deepEqual(sent.map(s => s.commandId), ['cmd-1', 'cmd-2', 'cmd-3']);
    assert.deepEqual(sent.map(s => s.sequenceOrder), [1, 2, 3]);

    const persisted = toPersistedActivities(outcome.saved);
    assert.deepEqual(persisted.map(a => a.id), ['srv-item-1', 'srv-item-2', 'srv-item-3']);
    assert.ok(persisted.every(a => a.persisted === true));
  });

  test('para na primeira falha sem reenviar etapas já gravadas nem tentar as seguintes', async () => {
    const drafts = buildLiturgicalItemDrafts([
      { id: 'act-1', title: 'Etapa 1', plannedDurationMinutes: 10 },
      { id: 'act-2', title: 'Etapa 2', plannedDurationMinutes: 15 },
      { id: 'act-3', title: 'Etapa 3', plannedDurationMinutes: 20 },
    ], 0);

    let seq = 0;
    const calls = [];
    const outcome = await saveEventItemsSequentially({
      supabase: {},
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      drafts,
      pendingCommandIds: new Map(),
      generateId: () => `cmd-${++seq}`,
      createItem: async (params) => {
        calls.push(params.title);
        if (params.sequenceOrder === 2) {
          return { status: 'DEFINITIVE_ERROR', message: 'Erro definitivo na etapa 2' };
        }
        return {
          status: 'SUCCESS',
          receipt: { result_entity_id: `srv-${params.sequenceOrder}` },
        };
      },
    });

    assert.deepEqual(calls, ['Etapa 1', 'Etapa 2']);
    assert.equal(outcome.saved.length, 1);
    assert.equal(outcome.saved[0].draft.title, 'Etapa 1');
    assert.equal(outcome.failed.draft.title, 'Etapa 2');
    assert.equal(outcome.failed.uncertain, false);
    assert.deepEqual(outcome.notAttempted.map(d => d.title), ['Etapa 3']);
  });

  test('resposta incerta reutiliza o mesmo command_id na nova tentativa; erro definitivo não reutiliza', async () => {
    const pendingCommandIds = new Map();
    const drafts = buildLiturgicalItemDrafts([
      { id: 'act-1', title: 'Louvor', plannedDurationMinutes: 20 },
    ], 0);

    let seq = 0;
    const seenCommands = [];

    const first = await saveEventItemsSequentially({
      supabase: {},
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      drafts,
      pendingCommandIds,
      generateId: () => `cmd-${++seq}`,
      createItem: async (params) => {
        seenCommands.push(params.commandId);
        throw new Error('Network timeout');
      },
    });
    assert.equal(first.failed.uncertain, true);
    assert.equal(seenCommands[0], 'cmd-1');

    const second = await saveEventItemsSequentially({
      supabase: {},
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      drafts,
      pendingCommandIds,
      generateId: () => `cmd-${++seq}`,
      createItem: async (params) => {
        seenCommands.push(params.commandId);
        return { status: 'DEFINITIVE_ERROR', message: 'Conflito definitivo' };
      },
    });
    assert.equal(second.failed.uncertain, false);
    assert.equal(seenCommands[1], 'cmd-1');

    const third = await saveEventItemsSequentially({
      supabase: {},
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      drafts,
      pendingCommandIds,
      generateId: () => `cmd-${++seq}`,
      createItem: async (params) => {
        seenCommands.push(params.commandId);
        return { status: 'SUCCESS', receipt: { result_entity_id: 'srv-ok' } };
      },
    });
    assert.equal(third.failed, null);
    assert.equal(third.saved.length, 1);
    assert.equal(seenCommands[2], 'cmd-2');
  });

  test('bloqueia acréscimo de etapas em evento carregado do servidor sem leitura de etapas na sessão (B2)', () => {
    const reloadedEvent = toPlanningEventFromServer({
      id: EVENT_ID,
      title: 'Culto Pós-Recarga',
      event_type: 'Culto',
      status: 'scheduled',
      planned_start_at: '2026-11-15T22:00:00.000Z',
      planned_end_at: '2026-11-15T23:30:00.000Z',
    }, 'America/Sao_Paulo');

    assert.equal(canAppendEventItemsToEvent(reloadedEvent), false);
    assert.match(UNKNOWN_SERVER_ITEMS_BLOCK_REASON, /B2/i);
    assert.match(UNKNOWN_SERVER_ITEMS_BLOCK_REASON, /ordem das etapas/i);
    assert.doesNotMatch(UNKNOWN_SERVER_ITEMS_BLOCK_REASON, /sequence_order/i);
    assert.doesNotMatch(UNKNOWN_SERVER_ITEMS_BLOCK_REASON, /nova edição|outra edição|crie uma/i);

    const sessionCreatedEvent = {
      id: 'ev-session-1',
      loadedFromServer: false,
      activitiesKnownInSession: true,
      activities: [],
    };
    assert.equal(canAppendEventItemsToEvent(sessionCreatedEvent), true);
  });

  test('4.3 resposta incerta bloqueia etapa com dados alterados e aplicação de modelo, mas permite repetição idêntica; erro definitivo não bloqueia', async () => {
    const pendingCommandIds = new Map();
    const sessionEvent = { id: EVENT_ID, loadedFromServer: false, activitiesKnownInSession: true, activities: [] };
    const draftA = buildLiturgicalItemDrafts([{ id: 'act-a', title: 'Louvor', plannedDurationMinutes: 20 }], 0)[0];
    const draftAltered = buildLiturgicalItemDrafts([{ id: 'act-a', title: 'Louvor Alterado', plannedDurationMinutes: 25 }], 0)[0];

    const keyA = buildEventItemDraftKey(EVENT_ID, draftA);
    const keyAltered = buildEventItemDraftKey(EVENT_ID, draftAltered);

    // Simula falha incerta em draftA
    await saveEventItemsSequentially({
      supabase: {},
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      drafts: [draftA],
      pendingCommandIds,
      generateId: () => 'cmd-uncertain-1',
      createItem: async () => { throw new Error('Timeout'); },
    });

    // Repetição idêntica permitida
    assert.equal(canAppendEventItemsToEvent(sessionEvent, pendingCommandIds, keyA), true);
    // Dados alterados bloqueados
    assert.equal(canAppendEventItemsToEvent(sessionEvent, pendingCommandIds, keyAltered), false);
    assert.equal(getAppendEventItemsBlockReason(sessionEvent, pendingCommandIds, keyAltered), UNCERTAIN_EVENT_ITEMS_BLOCK_REASON);
    // Aplicação de modelo (nextDraftKey = null) bloqueada
    assert.equal(canAppendEventItemsToEvent(sessionEvent, pendingCommandIds, null), false);

    // Após erro definitivo na repetição, bloqueio é liberado
    await saveEventItemsSequentially({
      supabase: {},
      churchId: CHURCH_ID,
      eventId: EVENT_ID,
      drafts: [draftA],
      pendingCommandIds,
      generateId: () => 'cmd-unused',
      createItem: async () => ({ status: 'DEFINITIVE_ERROR', message: 'Erro definitivo' }),
    });
    assert.equal(canAppendEventItemsToEvent(sessionEvent, pendingCommandIds, keyAltered), true);
    assert.equal(canAppendEventItemsToEvent(sessionEvent, pendingCommandIds, null), true);
  });

  describe('4.5 Aplicação de modelo usa e valida estrutura devolvida pelo servidor', () => {
    test('instantiateServiceTemplateRemote rejeita resposta vazia, success falso, template_id divergente e arrays ausentes', async () => {
      const invalidPayloads = [
        null,
        [],
        { success: false, template_id: TEMPLATE_ID, activities: [], parallelServices: [] },
        { success: true, template_id: 'outro-template', activities: [], parallelServices: [] },
        { success: true, template_id: TEMPLATE_ID, activities: null, parallelServices: [] },
        { success: true, template_id: TEMPLATE_ID, activities: [], parallelServices: null },
      ];

      for (const data of invalidPayloads) {
        const res = await instantiateServiceTemplateRemote(
          { rpc: async () => ({ data, error: null }) },
          CHURCH_ID,
          TEMPLATE_ID
        );
        assert.equal(res.success, false);
        assert.match(res.error, /estrutura válida/i);
      }
    });

    test('AppContext.applyServiceTemplateToEvent grava as etapas devolvidas pelo servidor quando o modelo foi alterado após carga local', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const itemCalls = [];
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') {
            return { data: [{ events: [], total_count: 0 }], error: null };
          }
          if (fn === 'list_event_types') {
            return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          }
          if (fn === 'list_service_templates') {
            return {
              data: [{
                id: TEMPLATE_ID,
                name: 'Modelo Local Antigo',
                active: true,
                activities: [{ id: 'old-1', title: 'Etapa Obsoleta Local', plannedDurationMinutes: 10 }],
                parallelServices: [],
              }],
              error: null,
            };
          }
          if (fn === 'get_service_template') {
            return {
              data: [{
                id: TEMPLATE_ID,
                name: 'Modelo Local Antigo',
                active: true,
                activities: [{ id: 'old-1', title: 'Etapa Obsoleta Local', plannedDurationMinutes: 10 }],
                parallelServices: [],
              }],
              error: null,
            };
          }
          if (fn === 'create_church_event_edition') {
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'create_church_event_edition',
                church_id: params.p_church_id,
                result_entity_id: EVENT_ID,
                result_payload: { event_id: EVENT_ID },
                created_at: '2026-11-01T00:00:00Z',
              }],
              error: null,
            };
          }
          if (fn === 'instantiate_service_template') {
            return {
              data: {
                success: true,
                template_id: TEMPLATE_ID,
                activities: [
                  { id: 'srv-act-1', title: 'Etapa Atualizada do Servidor', category: 'Louvor', plannedDurationMinutes: 30 },
                ],
                parallelServices: [
                  { id: 'srv-ps-1', name: 'Transmissão Servidor', teamId: null, prepRequiredMinutes: 20 },
                ],
              },
              error: null,
            };
          }
          if (fn === 'create_event_item') {
            itemCalls.push(params);
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'create_event_item',
                church_id: params.p_church_id,
                result_entity_id: 'item-srv-99',
                result_payload: { item_id: 'item-srv-99' },
                created_at: '2026-11-01T00:00:00Z',
              }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };

      await act(async () => {
        TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: CHURCH_ID, supabaseClient: mockClient },
            React.createElement(Consumer)
          )
        );
      });

      await act(async () => {
        await appCtx.createEventEdition({
          title: 'Culto Teste Modelo',
          type: 'Culto',
          plannedStartAt: '2026-11-01T19:00',
          plannedEndAt: '2026-11-01T20:30',
        });
      });

      let applyRes;
      await act(async () => {
        applyRes = await appCtx.applyServiceTemplateToEvent(TEMPLATE_ID);
      });

      assert.equal(applyRes.success, true);
      assert.equal(itemCalls.length, 1);
      assert.equal(itemCalls[0].p_title, 'Etapa Atualizada do Servidor');
      assert.equal(itemCalls[0].p_planned_duration_seconds, 1800);
      assert.equal(appCtx.event.activities[0].title, 'Etapa Atualizada do Servidor');
      assert.equal(appCtx.event.parallelServices[0].name, 'Transmissão Servidor');
    });
  });
});
