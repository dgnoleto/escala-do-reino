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
  buildParallelServiceDrafts,
  buildEventItemDraftKey,
  buildEventItemUpdateKey,
  buildEventItemRemoveKey,
  saveEventItemsSequentially,
  toPersistedActivities,
  toPersistedParallelServices,
  canAppendEventItemsToEvent,
  getAppendEventItemsBlockReason,
  UNKNOWN_SERVER_ITEMS_BLOCK_REASON,
  UNCERTAIN_EVENT_ITEMS_BLOCK_REASON,
} from '../src/utils/eventItemService.js';
import {
  createEventItem,
  updateEventItem,
  removeEventItem,
  reorderEventItems,
  validateLiturgicalReceipt,
} from '../src/utils/liturgicalCommandService.js';
import {
  toPlanningEventFromServer,
  calculateProgramDurations,
  getEventProgramRemote,
  setEventDurationPolicyRemote,
  publishEventProgramRemote,
  saveEventProgramDraftRemote,
  updateEventItemRemote,
  removeEventItemRemote,
} from '../src/utils/eventPlanningService.js';
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
    contents: `
      export { AppProvider, useApp } from './src/context/AppContext.jsx';
      export { default as PlanningView, isProgramPublicationBlocked } from './src/components/PlanningView.jsx';
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
const { AppProvider, useApp, PlanningView, isProgramPublicationBlocked } = await import(pathToFileURL(bundlePath).href);

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
      assert.equal(itemCalls.length, 2);
      assert.equal(itemCalls[0].p_title, 'Etapa Atualizada do Servidor');
      assert.equal(itemCalls[0].p_planned_duration_seconds, 1800);
      assert.equal(itemCalls[1].p_title, 'Transmissão Servidor');
      assert.equal(itemCalls[1].p_item_nature, 'parallel_support');
      assert.equal(itemCalls[1].p_planned_duration_seconds, 5400);
      assert.equal(appCtx.event.activities[0].title, 'Etapa Atualizada do Servidor');
      assert.equal(appCtx.event.parallelServices[0].name, 'Transmissão Servidor');
    });
  });

  describe('Pacote SQL 026 / Issues #29, #30, #51 — Leitura, Edição, Exclusão, Concorrência e Rascunho', () => {
    test('get_event_program hidrata litúrgicos e apoios paralelos após recarga com atividades conhecidas na sessão', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const emptyQuery = new Proxy({}, {
        get: (_target, property) => {
          if (property === 'then') {
            return (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          return () => emptyQuery;
        },
      });

      const mockClient = {
        from: () => emptyQuery,
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: {
                  id: EVENT_ID,
                  church_id: CHURCH_ID,
                  program_version: 1,
                  program_status: 'draft',
                  duration_policy: 'block',
                },
                items: [
                  {
                    id: 'item-lit-1',
                    item_nature: 'liturgical',
                    sequence_order: 1,
                    title: 'Abertura e Oração',
                    item_category: 'Geral',
                    planned_duration_seconds: 600,
                    prep_required_minutes: 0,
                    responsible_name: 'Pastor Marcos',
                    notes: 'Boas-vindas',
                    requires_playback: false,
                    updated_at: '2026-11-20T19:05:00Z',
                  },
                  {
                    id: 'item-ps-1',
                    item_nature: 'parallel_support',
                    sequence_order: 1,
                    title: 'Transmissão Online',
                    item_category: 'parallel_support',
                    planned_duration_seconds: 5400,
                    prep_required_minutes: 30,
                    responsible_name: 'Mídia',
                    notes: null,
                    requires_playback: false,
                    updated_at: '2026-11-20T19:00:00Z',
                  },
                ],
              },
              error: null,
            };
          }
          if (fn === 'list_event_types') return { data: [], error: null };
          if (fn === 'list_service_templates') return { data: [], error: null };
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Pós-026',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      await act(async () => {
        await appCtx.loadEventProgram(EVENT_ID);
      });

      assert.equal(appCtx.event.id, EVENT_ID);
      assert.equal(appCtx.event.activitiesKnownInSession, true);
      assert.equal(appCtx.event.activities.length, 1);
      assert.equal(appCtx.event.activities[0].id, 'item-lit-1');
      assert.equal(appCtx.event.activities[0].title, 'Abertura e Oração');
      assert.equal(appCtx.event.activities[0].plannedDurationMinutes, 10);
      assert.equal(appCtx.event.activities[0].updatedAt, '2026-11-20T19:05:00Z');

      assert.equal(appCtx.event.parallelServices.length, 1);
      assert.equal(appCtx.event.parallelServices[0].id, 'item-ps-1');
      assert.equal(appCtx.event.parallelServices[0].name, 'Transmissão Online');
      assert.equal(appCtx.event.parallelServices[0].prepRequiredMinutes, 30);
      assert.equal(appCtx.event.durationPolicy, 'block');
    });

    test('updateActivityInEvent envia expected_updated_at e atualiza estado local com novo updated_at', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const updateCalls = [];
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: {
                  id: EVENT_ID,
                  church_id: CHURCH_ID,
                  program_version: 1,
                  program_status: 'draft',
                  duration_policy: 'warn',
                },
                items: [{
                  id: 'item-edit-1',
                  item_nature: 'liturgical',
                  sequence_order: 1,
                  title: 'Título Antigo',
                  item_category: 'Louvor',
                  planned_duration_seconds: 900,
                  prep_required_minutes: 0,
                  responsible_name: 'Equipe',
                  notes: null,
                  requires_playback: false,
                  updated_at: '2026-11-20T10:00:00Z',
                }],
              },
              error: null,
            };
          }
          if (fn === 'update_event_item') {
            updateCalls.push(params);
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'update_event_item',
                church_id: params.p_church_id,
                result_entity_id: params.p_item_id,
                result_payload: { updated_at: '2026-11-20T11:00:00Z' },
                created_at: '2026-11-20T11:00:00Z',
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Edição',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      await act(async () => {
        await appCtx.loadEventProgram(EVENT_ID);
      });

      let res;
      await act(async () => {
        res = await appCtx.updateActivityInEvent('item-edit-1', {
          title: 'Título Novo',
          category: 'Palavra',
          plannedDurationMinutes: 20,
          responsibleMemberId: 'Pastor',
          notes: 'Texto base',
          requiresPlayback: true,
        });
      });

      assert.equal(res.success, true);
      assert.equal(updateCalls.length, 1);
      assert.equal(updateCalls[0].p_expected_updated_at, '2026-11-20T10:00:00Z');
      assert.equal(updateCalls[0].p_title, 'Título Novo');
      assert.equal(updateCalls[0].p_planned_duration_seconds, 1200);

      const actItem = appCtx.event.activities[0];
      assert.equal(actItem.title, 'Título Novo');
      assert.equal(actItem.category, 'Palavra');
      assert.equal(actItem.plannedDurationMinutes, 20);
      assert.equal(actItem.updatedAt, '2026-11-20T11:00:00Z');
    });

    test('updateActivityInEvent com conflito de concorrência 40001 devolve erro e não altera o estado local', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: {
                  id: EVENT_ID,
                  church_id: CHURCH_ID,
                  program_version: 1,
                  program_status: 'draft',
                  duration_policy: 'warn',
                },
                items: [{
                  id: 'item-conflict-1',
                  item_nature: 'liturgical',
                  sequence_order: 1,
                  title: 'Título Intacto',
                  item_category: 'Louvor',
                  planned_duration_seconds: 600,
                  prep_required_minutes: 0,
                  updated_at: '2026-11-20T10:00:00Z',
                }],
              },
              error: null,
            };
          }
          if (fn === 'update_event_item') {
            return {
              data: null,
              error: { code: '40001', message: 'Item foi modificado concorrentemente por outro usuário.' },
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Concorrência',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      await act(async () => {
        await appCtx.loadEventProgram(EVENT_ID);
      });

      let res;
      await act(async () => {
        res = await appCtx.updateActivityInEvent('item-conflict-1', {
          title: 'Tentativa Concorrente',
          category: 'Louvor',
          plannedDurationMinutes: 15,
        });
      });

      assert.equal(res.success, false);
      assert.match(res.error, /concorr|modificada por outro/i);
      // Estado local não é corrompido
      assert.equal(appCtx.event.activities[0].title, 'Título Intacto');
    });

    test('removeActivityFromEvent remove etapa do estado local ou preserva se backend falhar (P0020)', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let shouldFailWithP0020 = true;
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: {
                  id: EVENT_ID,
                  church_id: CHURCH_ID,
                  program_version: 1,
                  program_status: 'draft',
                  duration_policy: 'warn',
                },
                items: [{
                  id: 'item-del-1',
                  item_nature: 'liturgical',
                  sequence_order: 1,
                  title: 'Etapa para Excluir',
                  item_category: 'Louvor',
                  planned_duration_seconds: 600,
                  prep_required_minutes: 0,
                  updated_at: '2026-11-20T10:00:00Z',
                }],
              },
              error: null,
            };
          }
          if (fn === 'remove_event_item') {
            if (shouldFailWithP0020) {
              return {
                data: null,
                error: { code: 'P0020', message: 'Item possui alocações ativas.' },
              };
            }
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'remove_event_item',
                church_id: params.p_church_id,
                result_entity_id: params.p_item_id,
                result_payload: { removed: true },
                created_at: '2026-11-20T11:00:00Z',
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Remoção',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      await act(async () => {
        await appCtx.loadEventProgram(EVENT_ID);
      });

      // 1. Falha com P0020: etapa NÃO é removida localmente
      let resFail;
      await act(async () => {
        resFail = await appCtx.removeActivityFromEvent('item-del-1');
      });

      assert.equal(resFail.success, false);
      assert.match(resFail.error, /alocad|alocaç/i);
      assert.equal(appCtx.event.activities.length, 1);

      // 2. Sucesso: etapa é removida localmente
      shouldFailWithP0020 = false;
      let resOk;
      await act(async () => {
        resOk = await appCtx.removeActivityFromEvent('item-del-1');
      });

      assert.equal(resOk.success, true);
      assert.equal(appCtx.event.activities.length, 0);
    });

    test('publishCurrentProgram e saveCurrentProgramDraft atualizam program_version e program_status', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: {
                  id: EVENT_ID,
                  church_id: CHURCH_ID,
                  program_version: 1,
                  program_status: 'draft',
                  duration_policy: 'warn',
                },
                items: [],
              },
              error: null,
            };
          }
          if (fn === 'publish_event_program') {
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'publish_event_program',
                church_id: params.p_church_id,
                result_entity_id: params.p_event_id,
                result_payload: {
                  event_id: params.p_event_id,
                  program_version: 2,
                  program_status: 'published',
                  duration_policy: 'warn',
                  published_at: '2026-11-20T12:00:00Z',
                },
                created_at: '2026-11-20T12:00:00Z',
              }],
              error: null,
            };
          }
          if (fn === 'save_event_program_draft') {
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'save_event_program_draft',
                church_id: params.p_church_id,
                result_entity_id: params.p_event_id,
                result_payload: {
                  event_id: params.p_event_id,
                  program_version: 2,
                  program_status: 'draft',
                  published_at: null,
                },
                created_at: '2026-11-20T12:05:00Z',
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Versões',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      await act(async () => {
        await appCtx.loadEventProgram(EVENT_ID);
      });

      assert.equal(appCtx.event.programStatus, 'draft');

      // Publica
      let pubRes;
      await act(async () => {
        pubRes = await appCtx.publishCurrentProgram();
      });
      assert.equal(pubRes.success, true);
      assert.equal(appCtx.event.programStatus, 'published');
      assert.equal(appCtx.event.programVersion, 2);

      // Volta a rascunho
      let draftRes;
      await act(async () => {
        draftRes = await appCtx.saveCurrentProgramDraft();
      });
      assert.equal(draftRes.success, true);
      assert.equal(appCtx.event.programStatus, 'draft');
      assert.equal(appCtx.event.programVersion, 2);
    });
  });

  describe('Complementação B3 — 12 Cenários Focais das Issues #29, #30 e #51', () => {
    test('1. Modelo com etapa litúrgica e apoio persiste os dois com naturezas corretas', async () => {
      const litDrafts = buildLiturgicalItemDrafts([
        { id: 'act-1', title: 'Abertura', plannedDurationMinutes: 10 },
      ], 0);
      const parDrafts = buildParallelServiceDrafts([
        { id: 'par-1', name: 'Transmissão', plannedDurationMinutes: 90, prepRequiredMinutes: 30, teamId: 'midia' },
      ], 0);

      assert.equal(litDrafts[0].itemNature, 'liturgical');
      assert.equal(litDrafts[0].prepRequiredMinutes, 0);
      assert.equal(litDrafts[0].sequenceOrder, 1);

      assert.equal(parDrafts[0].itemNature, 'parallel_support');
      assert.equal(parDrafts[0].prepRequiredMinutes, 30);
      assert.equal(parDrafts[0].sequenceOrder, 1);

      const calls = [];
      const outcome = await saveEventItemsSequentially({
        supabase: {},
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        drafts: [...litDrafts, ...parDrafts],
        pendingCommandIds: new Map(),
        generateId: () => `cmd-${calls.length + 1}`,
        createItem: async (params) => {
          calls.push(params);
          return {
            status: 'SUCCESS',
            receipt: { result_entity_id: `srv-${params.itemNature}-${params.sequenceOrder}` },
          };
        },
      });

      assert.equal(outcome.failed, null);
      assert.equal(outcome.saved.length, 2);
      assert.equal(calls[0].itemNature, 'liturgical');
      assert.equal(calls[0].sequenceOrder, 1);
      assert.equal(calls[0].prepRequiredMinutes, 0);
      assert.equal(calls[1].itemNature, 'parallel_support');
      assert.equal(calls[1].sequenceOrder, 1);
      assert.equal(calls[1].prepRequiredMinutes, 30);
    });

    test('2. Falha parcial não marca item não confirmado como persistido', async () => {
      const drafts = [
        ...buildLiturgicalItemDrafts([{ id: 'act-1', title: 'Boas-vindas', plannedDurationMinutes: 5 }], 0),
        ...buildLiturgicalItemDrafts([{ id: 'act-2', title: 'Cânticos', plannedDurationMinutes: 20 }], 1),
      ];

      const outcome = await saveEventItemsSequentially({
        supabase: {},
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        drafts,
        pendingCommandIds: new Map(),
        generateId: () => 'cmd-1',
        createItem: async (params) => {
          if (params.sequenceOrder === 1) {
            return { status: 'SUCCESS', receipt: { result_entity_id: 'srv-confirmed-1' } };
          }
          return { status: 'DEFINITIVE_ERROR', message: 'Falha na etapa 2' };
        },
      });

      assert.equal(outcome.saved.length, 1);
      assert.equal(outcome.saved[0].receipt.result_entity_id, 'srv-confirmed-1');
      assert.ok(outcome.failed);
      assert.equal(outcome.failed.draft.title, 'Cânticos');

      const persisted = toPersistedActivities(outcome.saved);
      assert.equal(persisted.length, 1);
      assert.equal(persisted[0].id, 'srv-confirmed-1');
      assert.equal(persisted[0].persisted, true);
    });

    test('3. Duração ausente ou inválida não gera 300 segundos silenciosamente', async () => {
      // Duração ausente
      const draftsNoDuration = buildLiturgicalItemDrafts([{ id: 'act-1', title: 'Sem duração' }], 0);
      assert.notEqual(draftsNoDuration[0].plannedDurationSeconds, 300);
      assert.equal(draftsNoDuration[0].plannedDurationSeconds, 0);

      // saveEventItemsSequentially rejeita duração <= 0 para litúrgicos antes da chamada
      let called = false;
      const outcome = await saveEventItemsSequentially({
        supabase: {},
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        drafts: draftsNoDuration,
        pendingCommandIds: new Map(),
        generateId: () => 'cmd-invalid',
        createItem: async () => {
          called = true;
          return { status: 'SUCCESS', receipt: { result_entity_id: 'ok' } };
        },
      });
      assert.equal(called, false);
      assert.ok(outcome.failed);
      assert.match(outcome.failed.message, /duração/i);

      // createEventItem rejeita diretamente duração <= 0 para litúrgico
      const resLit = await createEventItem({
        supabase: {},
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        commandId: 'cmd-val-1',
        sequenceOrder: 1,
        title: 'Teste',
        itemNature: 'liturgical_step',
        plannedDurationSeconds: 0,
      });
      assert.equal(resLit.status, 'DEFINITIVE_ERROR');
      assert.match(resLit.message, /duração/i);
    });

    test('4. Criação de apoio envia preparação e natureza corretas com duração estritamente positiva', async () => {
      let rpcParams = null;
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'create_event_item') {
            rpcParams = params;
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'create_event_item',
                church_id: params.p_church_id,
                result_entity_id: 'par-item-99',
                result_payload: {
                  id: 'par-item-99',
                  item_nature: params.p_item_nature,
                  prep_required_minutes: params.p_prep_required_minutes,
                  planned_duration_seconds: params.p_planned_duration_seconds,
                  updated_at: '2026-11-20T12:00:00Z',
                },
                created_at: '2026-11-20T12:00:00Z',
              }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };

      // Rejeita duração zero para apoio paralelo antes da RPC
      const resZeroDur = await createEventItem({
        supabase: mockClient,
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        commandId: 'cmd-zero-par',
        sequenceOrder: 1,
        title: 'Sonoplastia',
        itemNature: 'parallel_support',
        plannedDurationSeconds: 0,
        prepRequiredMinutes: 45,
      });
      assert.equal(resZeroDur.status, 'DEFINITIVE_ERROR');
      assert.match(resZeroDur.message, /duração/i);

      const res = await createEventItem({
        supabase: mockClient,
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        commandId: 'cmd-create-par',
        sequenceOrder: 1,
        title: 'Sonoplastia',
        itemNature: 'parallel_support',
        plannedDurationSeconds: 3600,
        prepRequiredMinutes: 45,
      });

      assert.equal(res.status, 'SUCCESS');
      assert.equal(rpcParams.p_item_nature, 'parallel_support');
      assert.equal(rpcParams.p_prep_required_minutes, 45);
      assert.equal(rpcParams.p_planned_duration_seconds, 3600);

      // Rejeita prepRequiredMinutes fora do limite (0 a 180)
      const resInvalidPrep = await createEventItem({
        supabase: mockClient,
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        commandId: 'cmd-invalid-prep',
        sequenceOrder: 1,
        title: 'Sonoplastia',
        itemNature: 'parallel_support',
        plannedDurationSeconds: 3600,
        prepRequiredMinutes: 200,
      });
      assert.equal(resInvalidPrep.status, 'DEFINITIVE_ERROR');
      assert.match(resInvalidPrep.message, /preparação|180/i);
    });

    test('5. Edição de apoio envia o updated_at correto e atualiza o novo token', async () => {
      let receivedExpectedUpdatedAt = null;
      const newToken = '2026-11-20T13:00:00.000Z';
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'update_event_item') {
            receivedExpectedUpdatedAt = params.p_expected_updated_at;
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'update_event_item',
                church_id: params.p_church_id,
                result_entity_id: params.p_item_id,
                result_payload: {
                  id: params.p_item_id,
                  item_nature: 'parallel_support',
                  title: params.p_title,
                  updated_at: newToken,
                },
                created_at: '2026-11-20T13:00:00Z',
              }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };

      const res = await updateEventItem({
        supabase: mockClient,
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        itemId: 'item-par-1',
        commandId: 'cmd-update-par',
        title: 'Sonoplastia Atualizada',
        expectedUpdatedAt: '2026-11-20T12:00:00.000Z',
        plannedDurationSeconds: 3600,
        prepRequiredMinutes: 15,
        itemNature: 'parallel_support',
      });

      assert.equal(res.status, 'SUCCESS');
      assert.equal(receivedExpectedUpdatedAt, '2026-11-20T12:00:00.000Z');
      assert.equal(res.receipt.result_payload.updated_at, newToken);
    });

    test('6. Remoção de apoio preserva o estado local em 40001, P0020 ou resposta incerta', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let simulatedError = { code: '40001', message: 'concorrência' };
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: {
                  id: EVENT_ID,
                  church_id: CHURCH_ID,
                  program_version: 1,
                  program_status: 'draft',
                  duration_policy: 'warn',
                },
                items: [
                  {
                    id: 'par-rem-1',
                    event_id: EVENT_ID,
                    church_id: CHURCH_ID,
                    item_nature: 'parallel_support',
                    title: 'Transmissão Teste',
                    sequence_order: 1,
                    planned_duration_seconds: 5400,
                    prep_required_minutes: 10,
                    updated_at: '2026-11-20T12:00:00Z',
                  },
                ],
              },
              error: null,
            };
          }
          if (fn === 'remove_event_item') {
            if (simulatedError) {
              return { data: null, error: simulatedError };
            }
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'remove_event_item',
                church_id: params.p_church_id,
                result_entity_id: params.p_item_id,
                result_payload: { removed: true },
                created_at: '2026-11-20T12:00:00Z',
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Apoio Concorrência',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      await act(async () => {
        await appCtx.loadEventProgram(EVENT_ID);
      });

      assert.equal(appCtx.event.parallelServices.length, 1);

      // 1. Falha com 40001: estado local preservado
      let resFail40001;
      await act(async () => {
        resFail40001 = await appCtx.removeParallelServiceFromCurrentEvent('par-rem-1');
      });
      assert.equal(resFail40001.success, false);
      assert.equal(appCtx.event.parallelServices.length, 1);

      // 2. Falha com P0020: estado local preservado
      simulatedError = { code: 'P0020', message: 'Escalas atreladas ao apoio' };
      let resFailP0020;
      await act(async () => {
        resFailP0020 = await appCtx.removeParallelServiceFromCurrentEvent('par-rem-1');
      });
      assert.equal(resFailP0020.success, false);
      assert.equal(appCtx.event.parallelServices.length, 1);

      // 3. Sucesso: apoio removido localmente
      simulatedError = null;
      let resOk;
      await act(async () => {
        resOk = await appCtx.removeParallelServiceFromCurrentEvent('par-rem-1');
      });
      assert.equal(resOk.success, true);
      assert.equal(appCtx.event.parallelServices.length, 0);
    });

    test('7. Update incerto reutiliza o mesmo commandId', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const commandIdsSeen = [];
      let failOnce = true;
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: { id: EVENT_ID, church_id: CHURCH_ID, program_version: 1, program_status: 'draft', duration_policy: 'warn' },
                items: [{
                  id: 'act-upd-1',
                  event_id: EVENT_ID,
                  church_id: CHURCH_ID,
                  item_nature: 'liturgical',
                  title: 'Abertura',
                  sequence_order: 1,
                  planned_duration_seconds: 600,
                  prep_required_minutes: 0,
                  updated_at: '2026-11-20T12:00:00Z',
                }],
              },
              error: null,
            };
          }
          if (fn === 'update_event_item') {
            commandIdsSeen.push(params.p_command_id);
            if (failOnce) {
              failOnce = false;
              throw new Error('Network timeout in update');
            }
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'update_event_item',
                church_id: params.p_church_id,
                result_entity_id: params.p_item_id,
                result_payload: { id: params.p_item_id, title: params.p_title, updated_at: '2026-11-20T12:10:00Z' },
                created_at: '2026-11-20T12:10:00Z',
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Update Incerto',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
        await appCtx.loadEventProgram(EVENT_ID);
      });

      // Primeira tentativa: timeout
      await act(async () => {
        const res = await appCtx.updateActivityInEvent('act-upd-1', { title: 'Abertura Nova', plannedDurationMinutes: 10 });
        assert.equal(res.success, false);
      });

      // Segunda tentativa idêntica: reusa commandId
      await act(async () => {
        const res = await appCtx.updateActivityInEvent('act-upd-1', { title: 'Abertura Nova', plannedDurationMinutes: 10 });
        assert.equal(res.success, true);
      });

      assert.equal(commandIdsSeen.length, 2);
      assert.equal(commandIdsSeen[0], commandIdsSeen[1]);
    });

    test('8. Remove incerto reutiliza o mesmo commandId', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const commandIdsSeen = [];
      let failOnce = true;
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: { id: EVENT_ID, church_id: CHURCH_ID, program_version: 1, program_status: 'draft', duration_policy: 'warn' },
                items: [{
                  id: 'act-rm-1',
                  event_id: EVENT_ID,
                  church_id: CHURCH_ID,
                  item_nature: 'liturgical',
                  title: 'Louvor',
                  sequence_order: 1,
                  planned_duration_seconds: 1200,
                  prep_required_minutes: 0,
                  updated_at: '2026-11-20T12:00:00Z',
                }],
              },
              error: null,
            };
          }
          if (fn === 'remove_event_item') {
            commandIdsSeen.push(params.p_command_id);
            if (failOnce) {
              failOnce = false;
              throw new Error('Network timeout in remove');
            }
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'remove_event_item',
                church_id: params.p_church_id,
                result_entity_id: params.p_item_id,
                result_payload: { removed: true },
                created_at: '2026-11-20T12:10:00Z',
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Remove Incerto',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
        await appCtx.loadEventProgram(EVENT_ID);
      });

      // Primeira tentativa: timeout
      await act(async () => {
        const res = await appCtx.removeActivityFromEvent('act-rm-1');
        assert.equal(res.success, false);
      });

      // Segunda tentativa idêntica: reusa commandId
      await act(async () => {
        const res = await appCtx.removeActivityFromEvent('act-rm-1');
        assert.equal(res.success, true);
      });

      assert.equal(commandIdsSeen.length, 2);
      assert.equal(commandIdsSeen[0], commandIdsSeen[1]);
    });

    test('9. Mudança de payload durante comando incerto é bloqueada', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: { id: EVENT_ID, church_id: CHURCH_ID, program_version: 1, program_status: 'draft', duration_policy: 'warn' },
                items: [{
                  id: 'act-payload-1',
                  event_id: EVENT_ID,
                  church_id: CHURCH_ID,
                  item_nature: 'liturgical',
                  title: 'Abertura',
                  sequence_order: 1,
                  planned_duration_seconds: 600,
                  prep_required_minutes: 0,
                  updated_at: '2026-11-20T12:00:00Z',
                }],
              },
              error: null,
            };
          }
          if (fn === 'update_event_item') {
            throw new Error('Network timeout');
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Mudança Payload',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
        await appCtx.loadEventProgram(EVENT_ID);
      });

      // Dispara comando incerto com payload A
      await act(async () => {
        const res = await appCtx.updateActivityInEvent('act-payload-1', { title: 'Título A', plannedDurationMinutes: 10 });
        assert.equal(res.success, false);
      });

      // Tenta alterar com payload B diferente durante pendência incerta: BLOQUEIA
      await act(async () => {
        const resBlocked = await appCtx.updateActivityInEvent('act-payload-1', { title: 'Título B Diferente', plannedDurationMinutes: 15 });
        assert.equal(resBlocked.success, false);
        assert.match(resBlocked.error, /pendente de confirma|repeti/i);
      });
    });

    test('10. Falha em get_event_program bloqueia mutações na programação', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'get_event_program') {
            return { data: null, error: { message: 'Erro intencional no get_event_program' } };
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Bloqueio Total',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      await act(async () => {
        await appCtx.loadEventProgram(EVENT_ID);
      });

      assert.ok(appCtx.event.programLoadError);

      // Todas as mutações retornam falha fechada
      const r1 = await appCtx.addActivityToEvent({ title: 'Nova', plannedDurationMinutes: 10 });
      assert.equal(r1.success, false);

      const r2 = await appCtx.updateActivityInEvent('qualquer', { title: 'Editada' });
      assert.equal(r2.success, false);

      const r3 = await appCtx.removeActivityFromEvent('qualquer');
      assert.equal(r3.success, false);

      const r4 = await appCtx.moveActivityUpInEvent('qualquer');
      assert.equal(r4.success, false);

      const r5 = await appCtx.addParallelServiceToCurrentEvent({ name: 'Apoio' });
      assert.equal(r5.success, false);

      const r6 = await appCtx.updateParallelServiceInCurrentEvent('qualquer', { name: 'Apoio' });
      assert.equal(r6.success, false);

      const r7 = await appCtx.removeParallelServiceFromCurrentEvent('qualquer');
      assert.equal(r7.success, false);

      const r8 = await appCtx.applyServiceTemplateToEvent('tpl-1');
      assert.equal(r8.success, false);

      const r9 = await appCtx.setEventDurationPolicy('block');
      assert.equal(r9.success, false);

      const r10 = await appCtx.saveCurrentProgramDraft();
      assert.equal(r10.success, false);

      const r11 = await appCtx.publishCurrentProgram();
      assert.equal(r11.success, false);
    });

    test('11. Seleção de evento não produz duas chamadas concorrentes', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let getProgramCalls = 0;
      let resolveFirstCall;
      const firstCallPromise = new Promise(r => { resolveFirstCall = r; });

      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'get_event_program') {
            getProgramCalls++;
            await firstCallPromise;
            return {
              data: {
                success: true,
                event: { id: EVENT_ID, church_id: CHURCH_ID, program_version: 1, program_status: 'draft', duration_policy: 'warn' },
                items: [],
              },
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Carga Concorrente',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
      });

      // Dispara a primeira carga
      let p1, p2;
      act(() => {
        p1 = appCtx.loadEventProgram(EVENT_ID);
        // Dispara a segunda carga concorrente para o mesmo evento enquanto a primeira está em andamento
        p2 = appCtx.loadEventProgram(EVENT_ID);
      });

      // Libera a resposta
      resolveFirstCall();
      await act(async () => {
        await Promise.all([p1, p2]);
      });

      // Apenas 1 chamada RPC foi executada
      assert.equal(getProgramCalls, 1);
    });

    test('12. Reordenação litúrgica não mistura a sequência própria dos apoios paralelos', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let reorderItemsReceived = null;
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: { id: EVENT_ID, church_id: CHURCH_ID, program_version: 1, program_status: 'draft', duration_policy: 'warn' },
                items: [
                  {
                    id: 'act-seq-1',
                    event_id: EVENT_ID,
                    church_id: CHURCH_ID,
                    item_nature: 'liturgical',
                    title: 'Abertura',
                    sequence_order: 1,
                    planned_duration_seconds: 600,
                    prep_required_minutes: 0,
                    updated_at: '2026-11-20T12:00:00Z',
                  },
                  {
                    id: 'act-seq-2',
                    event_id: EVENT_ID,
                    church_id: CHURCH_ID,
                    item_nature: 'liturgical',
                    title: 'Louvor',
                    sequence_order: 2,
                    planned_duration_seconds: 1200,
                    prep_required_minutes: 0,
                    updated_at: '2026-11-20T12:00:00Z',
                  },
                  {
                    id: 'par-seq-1',
                    event_id: EVENT_ID,
                    church_id: CHURCH_ID,
                    item_nature: 'parallel_support',
                    title: 'Transmissão',
                    sequence_order: 1,
                    planned_duration_seconds: 5400,
                    prep_required_minutes: 30,
                    updated_at: '2026-11-20T12:00:00Z',
                  },
                ],
              },
              error: null,
            };
          }
          if (fn === 'reorder_event_items') {
            reorderItemsReceived = params.p_ordered_item_ids;
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'reorder_event_items',
                church_id: params.p_church_id,
                result_entity_id: params.p_event_id,
                result_payload: { event_id: params.p_event_id, total_items_reordered: params.p_ordered_item_ids.length },
                created_at: '2026-11-20T12:00:00Z',
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Sequências Independentes',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: false,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
        await appCtx.loadEventProgram(EVENT_ID);
      });

      // Inverte a ordem das etapas litúrgicas
      await act(async () => {
        const res = await appCtx.reorderActivities(['act-seq-2', 'act-seq-1']);
        assert.equal(res.success, true);
      });

      // Apenas os itens litúrgicos foram passados para reorder_event_items com a nova ordem
      assert.deepEqual(reorderItemsReceived, ['act-seq-2', 'act-seq-1']);

      // Os apoios paralelos permanecem preservados com sua própria sequência intacta
      assert.equal(appCtx.event.parallelServices.length, 1);
      assert.equal(appCtx.event.parallelServices[0].id, 'par-seq-1');
      assert.equal(appCtx.event.parallelServices[0].sequenceOrder, 1);
    });
  });

  describe('Microcorreção do Contrato de Duração — Validação Universal e Apoio de Modelo', () => {
    test('1 e 2. addParallelServiceToCurrentEvent rejeita duração zero e negativa antes da RPC', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }
      let rpcCalled = false;
      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'create_event_item') {
            rpcCalled = true;
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Apoio Teste',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: false,
          activitiesKnownInSession: true,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      // Duração 0
      let res0;
      await act(async () => {
        res0 = await appCtx.addParallelServiceToCurrentEvent({
          name: 'Mídia',
          durationMinutes: 0,
          prepRequiredMinutes: 10,
        });
      });
      assert.equal(res0.success, false);
      assert.match(res0.error, /duraç(ã|a)o.*maior que zero/i);
      assert.equal(rpcCalled, false);

      // Duração negativa
      let resNeg;
      await act(async () => {
        resNeg = await appCtx.addParallelServiceToCurrentEvent({
          name: 'Mídia',
          durationMinutes: -5,
          prepRequiredMinutes: 10,
        });
      });
      assert.equal(resNeg.success, false);
      assert.match(resNeg.error, /duraç(ã|a)o.*maior que zero/i);
      assert.equal(rpcCalled, false);
      assert.equal(appCtx.event.parallelServices.length, 0);
    });

    test('3. addParallelServiceToCurrentEvent envia p_planned_duration_seconds correto para duração positiva', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }
      let receivedParams = null;
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'create_event_item') {
            receivedParams = params;
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'create_event_item',
                church_id: params.p_church_id,
                result_entity_id: 'par-item-persisted',
                result_payload: {
                  id: 'par-item-persisted',
                  item_nature: 'parallel_support',
                  planned_duration_seconds: params.p_planned_duration_seconds,
                  prep_required_minutes: params.p_prep_required_minutes,
                  updated_at: '2026-11-20T12:00:00Z',
                },
                created_at: '2026-11-20T12:00:00Z',
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Apoio Positivo',
          status: 'scheduled',
          activities: [],
          parallelServices: [],
          loadedFromServer: false,
          activitiesKnownInSession: true,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      let res;
      await act(async () => {
        res = await appCtx.addParallelServiceToCurrentEvent({
          name: 'Sonoplastia',
          durationMinutes: 45,
          prepRequiredMinutes: 15,
        });
      });
      assert.equal(res.success, true);
      assert.ok(receivedParams);
      assert.equal(receivedParams.p_item_nature, 'parallel_support');
      assert.equal(receivedParams.p_planned_duration_seconds, 2700);
      assert.equal(receivedParams.p_prep_required_minutes, 15);
      assert.equal(appCtx.event.parallelServices.length, 1);
      assert.equal(appCtx.event.parallelServices[0].plannedDurationSeconds, 2700);
    });

    test('4. updateParallelServiceInCurrentEvent rejeita duração zero sem mudar estado local', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }
      let rpcCalled = false;
      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: { id: EVENT_ID, church_id: CHURCH_ID, program_version: 1, program_status: 'draft' },
                items: [{
                  id: 'par-existing-1',
                  item_nature: 'parallel_support',
                  sequence_order: 1,
                  title: 'Transmissão',
                  planned_duration_seconds: 3600,
                  prep_required_minutes: 10,
                  updated_at: '2026-11-20T10:00:00Z',
                }],
              },
              error: null,
            };
          }
          if (fn === 'update_event_item') {
            rpcCalled = true;
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Edição Apoio',
          status: 'scheduled',
          activities: [],
          parallelServices: [{
            id: 'par-existing-1',
            name: 'Transmissão',
            durationMinutes: 60,
            plannedDurationSeconds: 3600,
            prepRequiredMinutes: 10,
            updatedAt: '2026-11-20T10:00:00Z',
          }],
          loadedFromServer: true,
          activitiesKnownInSession: true,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
        await appCtx.loadEventProgram(EVENT_ID);
      });

      let res;
      await act(async () => {
        res = await appCtx.updateParallelServiceInCurrentEvent('par-existing-1', {
          name: 'Transmissão Editada',
          durationMinutes: 0,
          prepRequiredMinutes: 10,
        });
      });
      assert.equal(res.success, false);
      assert.match(res.error, /duraç(ã|a)o.*maior que zero/i);
      assert.equal(rpcCalled, false);
      assert.equal(appCtx.event.parallelServices[0].name, 'Transmissão');
      assert.equal(appCtx.event.parallelServices[0].durationMinutes, 60);
    });

    test('5, 6 e 7. Modelo deriva janela planejada do evento (incluindo meia-noite) e apoios não somam na sequência principal', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const itemCalls = [];
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Vigília', active: true }], error: null };
          if (fn === 'list_service_templates' || fn === 'get_service_template') {
            return {
              data: [{
                id: TEMPLATE_ID,
                name: 'Vigília',
                active: true,
                activities: [{ id: 'tpl-act-1', title: 'Louvor Inicial', plannedDurationMinutes: 30 }],
                parallelServices: [{ id: 'tpl-ps-1', name: 'Intercessão Paralela' }],
              }],
              error: null,
            };
          }
          if (fn === 'instantiate_service_template') {
            return {
              data: {
                success: true,
                template_id: TEMPLATE_ID,
                name: 'Vigília',
                activities: [{ id: 'tpl-act-1', title: 'Louvor Inicial', plannedDurationMinutes: 30 }],
                parallelServices: [{ id: 'tpl-ps-1', name: 'Intercessão Paralela' }],
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
                result_entity_id: `srv-${params.p_item_nature}`,
                result_payload: {
                  id: `srv-${params.p_item_nature}`,
                  item_nature: params.p_item_nature,
                  planned_duration_seconds: params.p_planned_duration_seconds,
                  prep_required_minutes: params.p_prep_required_minutes,
                  updated_at: '2026-11-20T12:00:00Z',
                },
                created_at: '2026-11-20T12:00:00Z',
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

      // Evento que cruza a meia-noite: 23:00 -> 01:30 do dia seguinte (2h30 = 9000 s = 150 min)
      await act(async () => {
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Vigília da Virada',
          status: 'scheduled',
          type: 'Vigília',
          plannedStartAt: '2026-12-31T23:00',
          plannedEndAt: '2027-01-01T01:30',
          activities: [],
          parallelServices: [],
          loadedFromServer: false,
          activitiesKnownInSession: true,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      let res;
      await act(async () => {
        res = await appCtx.applyServiceTemplateToEvent(TEMPLATE_ID);
      });

      assert.equal(res.success, true);
      assert.equal(itemCalls.length, 2);
      // Litúrgico: 30 min = 1800 s
      assert.equal(itemCalls[0].p_item_nature, 'liturgical');
      assert.equal(itemCalls[0].p_planned_duration_seconds, 1800);
      // Apoio: derivado da janela do evento (2h30 = 9000 s)
      assert.equal(itemCalls[1].p_item_nature, 'parallel_support');
      assert.equal(itemCalls[1].p_planned_duration_seconds, 9000);

      // Verificação da soma litúrgica principal: o apoio de 9000s (150 min) NÃO é somado à sequência litúrgica
      const program = calculateProgramDurations(appCtx.event);
      assert.equal(program.occupiedMinutes, 30); // Apenas os 30 min de Louvor Inicial
      assert.equal(program.availableMinutes, 150); // Janela total do evento de 23:00 a 01:30
      assert.equal(program.remainingMinutes, 120);
    });

    test('8 e 9. Modelo aplicado a evento sem janela válida falha antes da RPC sem correções silenciosas', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }
      let rpcCalled = false;
      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'list_service_templates' || fn === 'get_service_template') {
            return {
              data: [{
                id: TEMPLATE_ID,
                name: 'Culto Regular',
                active: true,
                activities: [{ id: 'tpl-act-1', title: 'Abertura', plannedDurationMinutes: 10 }],
                parallelServices: [{ id: 'tpl-ps-1', name: 'Recepção' }],
              }],
              error: null,
            };
          }
          if (fn === 'instantiate_service_template') {
            return {
              data: {
                success: true,
                template_id: TEMPLATE_ID,
                name: 'Culto Regular',
                activities: [{ id: 'tpl-act-1', title: 'Abertura', plannedDurationMinutes: 10 }],
                parallelServices: [{ id: 'tpl-ps-1', name: 'Recepção' }],
              },
              error: null,
            };
          }
          if (fn === 'create_event_item') {
            rpcCalled = true;
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

      // Evento com janela inválida (término igual ao início)
      await act(async () => {
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Janela Inválida',
          status: 'scheduled',
          type: 'Culto',
          plannedStartAt: '2026-11-20T19:00',
          plannedEndAt: '2026-11-20T19:00',
          activities: [],
          parallelServices: [],
          loadedFromServer: false,
          activitiesKnownInSession: true,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      let resEqual;
      await act(async () => {
        resEqual = await appCtx.applyServiceTemplateToEvent(TEMPLATE_ID);
      });
      assert.equal(resEqual.success, false);
      assert.match(resEqual.error, /janela.*inválida/i);
      assert.equal(rpcCalled, false);

      // Evento com janela invertida (término anterior ao início)
      await act(async () => {
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Janela Invertida',
          status: 'scheduled',
          type: 'Culto',
          plannedStartAt: '2026-11-20T20:00',
          plannedEndAt: '2026-11-20T19:00',
          activities: [],
          parallelServices: [],
          loadedFromServer: false,
          activitiesKnownInSession: true,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      let resInverted;
      await act(async () => {
        resInverted = await appCtx.applyServiceTemplateToEvent(TEMPLATE_ID);
      });
      assert.equal(resInverted.success, false);
      assert.match(resInverted.error, /janela.*inválida/i);
      assert.equal(rpcCalled, false);

      // saveEventItemsSequentially com fallback ausente/inválido não inventa 300s ou 1s e falha estritamente
      const draftsWithInvalid = buildParallelServiceDrafts([{ id: 'p1', name: 'Apoio' }], 0, { fallbackDurationSeconds: 0 });
      assert.equal(draftsWithInvalid[0].plannedDurationSeconds, 0);

      const outcome = await saveEventItemsSequentially({
        supabase: {},
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        drafts: draftsWithInvalid,
        pendingCommandIds: new Map(),
        generateId: () => 'cmd-fail',
        createItem: async () => {
          throw new Error('Não deveria chamar createItem');
        },
      });
      assert.equal(outcome.saved.length, 0);
      assert.ok(outcome.failed);
      assert.match(outcome.failed.message, /duração/i);
    });
  });

  describe('Criação de Edição com Apoios Persistentes — Issues #29, #30 e #51', () => {
    test('1, 2, 3 e 5. createEventEdition com atividade e apoio envia ambos a create_event_item com sequências independentes e IDs persistidos', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const itemCalls = [];
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'list_service_templates') return { data: [], error: null };
          if (fn === 'create_church_event_edition') {
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'create_church_event_edition',
                church_id: params.p_church_id,
                result_entity_id: 'ev-new-1',
                result_payload: { event_id: 'ev-new-1' },
                created_at: '2026-11-20T12:00:00Z',
              }],
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
                result_entity_id: `srv-${params.p_item_nature}-${params.p_sequence_order}`,
                result_payload: {
                  id: `srv-${params.p_item_nature}-${params.p_sequence_order}`,
                  item_nature: params.p_item_nature,
                  planned_duration_seconds: params.p_planned_duration_seconds,
                  prep_required_minutes: params.p_prep_required_minutes,
                  updated_at: '2026-11-20T12:00:00Z',
                },
                created_at: '2026-11-20T12:00:00Z',
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

      let res;
      await act(async () => {
        res = await appCtx.createEventEdition({
          title: 'Culto Inicial Completo',
          type: 'Culto',
          plannedStartAt: '2026-11-20T19:00',
          plannedEndAt: '2026-11-20T20:30', // Janela de 90 min = 5400 s
          activities: [
            { id: 'act-init-1', title: 'Abertura e Boas-Vindas', plannedDurationMinutes: 15 },
          ],
          parallelServices: [
            { id: 'ps-init-1', name: 'Transmissão Online', prepRequiredMinutes: 20 },
          ],
        });
      });

      assert.equal(res.success, true);
      assert.equal(itemCalls.length, 2);

      // Litúrgico: ordem 1, duração própria (15 min = 900 s)
      assert.equal(itemCalls[0].p_item_nature, 'liturgical');
      assert.equal(itemCalls[0].p_sequence_order, 1);
      assert.equal(itemCalls[0].p_planned_duration_seconds, 900);

      // Apoio: ordem 1 (sequência própria independente), duração derivada da janela (5400 s)
      assert.equal(itemCalls[1].p_item_nature, 'parallel_support');
      assert.equal(itemCalls[1].p_sequence_order, 1);
      assert.equal(itemCalls[1].p_planned_duration_seconds, 5400);
      assert.equal(itemCalls[1].p_prep_required_minutes, 20);

      // Estado local contém os IDs e duração confirmados pelo servidor
      assert.equal(appCtx.event.activities.length, 1);
      assert.equal(appCtx.event.activities[0].id, 'srv-liturgical-1');
      assert.equal(appCtx.event.parallelServices.length, 1);
      assert.equal(appCtx.event.parallelServices[0].id, 'srv-parallel_support-1');
      assert.equal(appCtx.event.parallelServices[0].plannedDurationSeconds, 5400);

      // Contagens no resultado
      assert.equal(res.liturgicalSavedCount, 1);
      assert.equal(res.liturgicalRequestedCount, 1);
      assert.equal(res.parallelSavedCount, 1);
      assert.equal(res.parallelRequestedCount, 1);
    });

    test('4. Evento cruzando meia-noite produz duração correta para apoio inicial', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const itemCalls = [];
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'list_service_templates') return { data: [], error: null };
          if (fn === 'create_church_event_edition') {
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'create_church_event_edition',
                church_id: params.p_church_id,
                result_entity_id: 'ev-midnight-1',
                result_payload: { event_id: 'ev-midnight-1' },
                created_at: '2026-12-31T23:00:00Z',
              }],
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
                result_entity_id: `srv-${params.p_item_nature}`,
                result_payload: {
                  id: `srv-${params.p_item_nature}`,
                  item_nature: params.p_item_nature,
                  planned_duration_seconds: params.p_planned_duration_seconds,
                  prep_required_minutes: params.p_prep_required_minutes,
                  updated_at: '2026-12-31T23:00:00Z',
                },
                created_at: '2026-12-31T23:00:00Z',
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

      let res;
      await act(async () => {
        res = await appCtx.createEventEdition({
          title: 'Vigília da Virada',
          type: 'Culto',
          plannedStartAt: '2026-12-31T23:00',
          plannedEndAt: '2027-01-01T01:30', // Janela de 2h30 = 9000 s
          activities: [],
          parallelServices: [
            { id: 'ps-vig-1', name: 'Intercessão' },
          ],
        });
      });

      assert.equal(res.success, true);
      assert.equal(itemCalls.length, 1);
      assert.equal(itemCalls[0].p_item_nature, 'parallel_support');
      assert.equal(itemCalls[0].p_planned_duration_seconds, 9000);
      assert.equal(appCtx.event.parallelServices[0].plannedDurationSeconds, 9000);
    });

    test('6 e 7. Falha parcial mantém apenas os itens confirmados no estado e apoio sem recibo não entra como persistido', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let callIndex = 0;
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'list_service_templates') return { data: [], error: null };
          if (fn === 'create_church_event_edition') {
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'create_church_event_edition',
                church_id: params.p_church_id,
                result_entity_id: 'ev-partial-1',
                result_payload: { event_id: 'ev-partial-1' },
                created_at: '2026-11-20T12:00:00Z',
              }],
              error: null,
            };
          }
          if (fn === 'create_event_item') {
            callIndex++;
            if (params.p_item_nature === 'parallel_support') {
              // Simula falha na gravação do apoio paralelo
              return { data: null, error: { code: 'P0001', message: 'Falha simulada no apoio' } };
            }
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'create_event_item',
                church_id: params.p_church_id,
                result_entity_id: 'srv-lit-ok',
                result_payload: {
                  id: 'srv-lit-ok',
                  item_nature: 'liturgical',
                  planned_duration_seconds: params.p_planned_duration_seconds,
                  prep_required_minutes: 0,
                  updated_at: '2026-11-20T12:00:00Z',
                },
                created_at: '2026-11-20T12:00:00Z',
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

      let res;
      await act(async () => {
        res = await appCtx.createEventEdition({
          title: 'Culto Falha Parcial',
          type: 'Culto',
          plannedStartAt: '2026-11-20T19:00',
          plannedEndAt: '2026-11-20T20:30',
          activities: [
            { id: 'act-ok-1', title: 'Etapa Confirmada', plannedDurationMinutes: 10 },
          ],
          parallelServices: [
            { id: 'ps-fail-1', name: 'Apoio Não Confirmado' },
          ],
        });
      });

      assert.equal(res.success, true);
      assert.equal(res.itemsFailed, true);
      assert.match(res.warning, /nem todos os itens foram gravados/i);

      // Estado local contém apenas a etapa confirmada; apoio não entra no estado
      assert.equal(appCtx.event.activities.length, 1);
      assert.equal(appCtx.event.activities[0].id, 'srv-lit-ok');
      assert.equal(appCtx.event.parallelServices.length, 0);

      assert.equal(res.liturgicalSavedCount, 1);
      assert.equal(res.parallelSavedCount, 0);
      assert.equal(res.parallelRequestedCount, 1);
    });

    test('8. Janela inválida com apoios bloqueia antes de create_church_event_edition', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let createEditionCalled = false;
      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'list_service_templates') return { data: [], error: null };
          if (fn === 'create_church_event_edition') {
            createEditionCalled = true;
            return { data: [], error: null };
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

      let res;
      await act(async () => {
        res = await appCtx.createEventEdition({
          title: 'Culto Janela Invertida',
          type: 'Culto',
          plannedStartAt: '2026-11-20T20:00',
          plannedEndAt: '2026-11-20T19:00', // Inválida: fim anterior ao início
          activities: [],
          parallelServices: [
            { id: 'ps-inv-1', name: 'Mídia' },
          ],
        });
      });

      assert.equal(res.success, false);
      assert.match(res.error, /término.*posterior ao início|janela.*inválida/i);
      assert.equal(createEditionCalled, false);
    });

    test('9. Evento sem apoios continua seguindo o comportamento anterior', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let itemCallCount = 0;
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'list_service_templates') return { data: [], error: null };
          if (fn === 'create_church_event_edition') {
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'create_church_event_edition',
                church_id: params.p_church_id,
                result_entity_id: 'ev-no-ps-1',
                result_payload: { event_id: 'ev-no-ps-1' },
                created_at: '2026-11-20T12:00:00Z',
              }],
              error: null,
            };
          }
          if (fn === 'create_event_item') {
            itemCallCount++;
            return {
              data: [{
                command_id: params.p_command_id,
                action: 'create_event_item',
                church_id: params.p_church_id,
                result_entity_id: 'srv-lit-single',
                result_payload: {
                  id: 'srv-lit-single',
                  item_nature: 'liturgical',
                  planned_duration_seconds: params.p_planned_duration_seconds,
                  prep_required_minutes: 0,
                  updated_at: '2026-11-20T12:00:00Z',
                },
                created_at: '2026-11-20T12:00:00Z',
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

      let res;
      await act(async () => {
        res = await appCtx.createEventEdition({
          title: 'Culto Somente Litúrgico',
          type: 'Culto',
          plannedStartAt: '2026-11-20T19:00',
          plannedEndAt: '2026-11-20T20:30',
          activities: [
            { id: 'act-solo', title: 'Louvor Único', plannedDurationMinutes: 30 },
          ],
          parallelServices: [],
        });
      });

      assert.equal(res.success, true);
      assert.equal(itemCallCount, 1);
      assert.equal(appCtx.event.activities.length, 1);
      assert.equal(appCtx.event.activities[0].id, 'srv-lit-single');
      assert.equal(appCtx.event.parallelServices.length, 0);
      assert.equal(res.parallelSavedCount, 0);
    });

    test('10. Não permanecem no código as afirmações e identificadores obsoletos', () => {
      const pathsToCheck = [
        path.resolve('src/utils/eventItemService.js'),
        path.resolve('src/context/AppContext.jsx'),
        path.resolve('src/components/PlanningView.jsx'),
      ];

      const forbiddenPhrases = [
        'Não existe RPC para ler etapas de volta, editar ou remover',
        'Serviços paralelos NÃO são gravados',
        'PARALLEL_SERVICES_NOT_PERSISTED_NOTICE',
      ];

      for (const filePath of pathsToCheck) {
        const content = fs.readFileSync(filePath, 'utf-8');
        for (const phrase of forbiddenPhrases) {
          assert.equal(
            content.includes(phrase),
            false,
            `Arquivo ${path.basename(filePath)} não deve conter a frase/identificador obsoleto: "${phrase}"`
          );
        }
      }
    });

    test('C1: Duração planejada deve ser número inteiro > 0 sem fallback silencioso para 5', async () => {
      let appCtx;
      const Consumer = () => {
        appCtx = useApp();
        return null;
      };

      await act(async () => {
        TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: CHURCH_ID },
            React.createElement(Consumer)
          )
        );
      });

      // Criação com duração vazia ou <= 0
      const res1 = appCtx.addActivityToEvent({ title: 'Etapa Sem Duração', plannedDurationMinutes: '' });
      assert.equal(res1.success, false);
      assert.ok(res1.error.includes('maior que zero'));

      const res2 = appCtx.addActivityToEvent({ title: 'Etapa Zero', plannedDurationMinutes: 0 });
      assert.equal(res2.success, false);
      assert.ok(res2.error.includes('maior que zero'));

      const res3 = appCtx.addActivityToEvent({ title: 'Etapa Negativa', plannedDurationMinutes: -5 });
      assert.equal(res3.success, false);

      const res4 = appCtx.addActivityToEvent({ title: 'Etapa Decimal', plannedDurationMinutes: 10.5 });
      assert.equal(res4.success, false);

      // Criação válida
      const valid = appCtx.addActivityToEvent({ title: 'Etapa Válida', plannedDurationMinutes: 12 });
      assert.equal(valid.success, true);
      assert.equal(valid.activity.plannedDurationMinutes, 12);
      assert.equal(valid.activity.plannedDurationSeconds, 720);

      // Edição: se duração omitida, preserva existente
      const editOmitted = await appCtx.updateActivityInEvent(valid.activity.id, { title: 'Etapa Editada' });
      assert.equal(editOmitted.success, true);
      assert.equal(editOmitted.activity.plannedDurationMinutes, 12);

      // Edição: se informada inválida, rejeita sem fallback para 5
      const editInvalid = await appCtx.updateActivityInEvent(valid.activity.id, { plannedDurationMinutes: 0 });
      assert.equal(editInvalid.success, false);
      assert.ok(editInvalid.error.includes('maior que zero'));
    });

    test('C2: DraftKey de apoio paralelo inclui prepRequiredMinutes e preflight respeita pendência incerta', async () => {
      const draft = {
        itemNature: 'parallel_support',
        sequenceOrder: 1,
        title: 'Som',
        plannedDurationSeconds: 1800,
        prepRequiredMinutes: 30,
        designatedTeamId: null,
        nominalLeaderMemberId: null,
      };

      const key = buildEventItemDraftKey(EVENT_ID, draft);
      assert.ok(key.includes('30'));

      const pendingMap = new Map();
      pendingMap.set(key, 'cmd-incerto-1');

      // Tentativa de adicionar rascunho diferente do retido
      const draftDivergent = { ...draft, title: 'Transmissão' };
      const divergentKey = buildEventItemDraftKey(EVENT_ID, draftDivergent);
      const blockReason = getAppendEventItemsBlockReason(
        { id: EVENT_ID, loadedFromServer: true, activitiesKnownInSession: true },
        pendingMap,
        divergentKey
      );
      assert.equal(blockReason, UNCERTAIN_EVENT_ITEMS_BLOCK_REASON);

      // Tentativa com rascunho idêntico é permitida
      const allowIdentical = getAppendEventItemsBlockReason(
        { id: EVENT_ID, loadedFromServer: true, activitiesKnownInSession: true },
        pendingMap,
        key
      );
      assert.equal(allowIdentical, null);
    });

    test('C3: Recarrega programa forçado pós-reordenação e bloqueia mutações se sincronização falhar', async () => {
      let appCtx;
      const Consumer = () => {
        appCtx = useApp();
        return null;
      };

      let reorderCalled = false;
      let reloadCallCount = 0;

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'reorder_event_items') {
            reorderCalled = true;
            return {
              data: [{
                command_id: params.p_command_id,
                church_id: CHURCH_ID,
                action: 'reorder_event_items',
                result_entity_id: params.p_event_id,
                result_payload: { event_id: params.p_event_id },
                created_at: '2026-11-21T10:00:00Z',
              }],
              error: null,
            };
          }
          if (fn === 'get_event_program') {
            reloadCallCount++;
            return { data: null, error: { message: 'Timeout ao recarregar programa' } };
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto de Teste',
          loadedFromServer: true,
          activitiesKnownInSession: true,
          activities: [
            { id: 'act-1', sequenceOrder: 1, title: 'Item 1' },
            { id: 'act-2', sequenceOrder: 2, title: 'Item 2' },
          ],
        }]);
        appCtx.selectEvent(EVENT_ID);
      });

      let reorderRes;
      await act(async () => {
        reorderRes = await appCtx.reorderActivities(['act-2', 'act-1']);
      });

      assert.equal(reorderCalled, true);
      assert.equal(reloadCallCount, 1);
      assert.equal(reorderRes.success, true);
      assert.ok(reorderRes.syncError);

      const mutateRes = appCtx.addActivityToEvent({ title: 'Item 3', plannedDurationMinutes: 10 });
      assert.equal(mutateRes.success, false);
      assert.ok(mutateRes.error.includes('não foi carregada com sucesso') || mutateRes.error.includes('bloqueadas'));
    });

    test('C4: dispatchLiturgicalRpc e wrappers propagam e reconhecem códigos 40001 e P0020', async () => {
      const clientConcurrency = {
        rpc: async () => ({
          data: null,
          error: { code: '40001', message: 'could not serialize access due to concurrent update' },
        }),
      };
      const resUpdate = await updateEventItemRemote(clientConcurrency, {
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        itemId: '00000000-0000-4000-8000-000000000011',
        title: 'Atualizar',
        plannedDurationSeconds: 300,
        expectedUpdatedAt: '2026-11-21T09:00:00Z',
      });
      assert.equal(resUpdate.success, false);
      assert.equal(resUpdate.concurrencyConflict, true);
      assert.ok(resUpdate.error.includes('Conflito de concorrência'));

      const clientBlocked = {
        rpc: async () => ({
          data: null,
          error: { code: 'P0020', message: 'Item cannot be removed because it has dependencies' },
        }),
      };
      const resRemove = await removeEventItemRemote(clientBlocked, {
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        itemId: '00000000-0000-4000-8000-000000000011',
        expectedUpdatedAt: '2026-11-21T09:00:00Z',
      });
      assert.equal(resRemove.success, false);
      assert.equal(resRemove.blockedByAssignment, true);
      assert.ok(resRemove.error.includes('existem voluntários ou equipes'));
    });

    test('C5: Mapa de requisições de carregamento (A->B->A) evita que resposta defasada sobrescreva evento', async () => {
      let appCtx;
      const Consumer = () => {
        appCtx = useApp();
        return null;
      };

      let resolveA1;
      const promiseA1 = new Promise(r => { resolveA1 = r; });

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            if (params.p_event_id === 'event-A') {
              return promiseA1;
            }
            if (params.p_event_id === 'event-B') {
              return {
                data: [{
                  event: { id: 'event-B', title: 'Culto B' },
                  items: [{ id: 'item-b1', item_nature: 'liturgical', sequence_order: 1, title: 'Louvor B', planned_duration_seconds: 600 }],
                }],
                error: null,
              };
            }
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
        appCtx.setEvents([
          { id: 'event-A', title: 'Culto A', loadedFromServer: true, activities: [] },
          { id: 'event-B', title: 'Culto B', loadedFromServer: true, activities: [] },
        ]);
      });

      const loadA1Promise = appCtx.loadEventProgram('event-A');

      await act(async () => {
        await appCtx.loadEventProgram('event-B');
      });

      const evB = appCtx.events.find(e => e.id === 'event-B');
      assert.equal(evB.activitiesKnownInSession, true);
      assert.equal(evB.activities.length, 1);
      assert.equal(evB.activities[0].title, 'Louvor B');

      let resolveA2;
      const promiseA2 = new Promise(r => { resolveA2 = r; });
      mockClient.rpc = async (fn, params) => {
        if (params.p_event_id === 'event-A') return promiseA2;
        return { data: [], error: null };
      };

      const loadA2Promise = appCtx.loadEventProgram('event-A', null, { force: true });

      resolveA1({
        data: [{
          event: { id: 'event-A', title: 'Culto A Versão Velha' },
          items: [{ id: 'item-old', item_nature: 'liturgical', sequence_order: 1, title: 'Item Obsoleto', planned_duration_seconds: 300 }],
        }],
        error: null,
      });

      const resA1 = await loadA1Promise;
      assert.equal(resA1.success, false);
      assert.ok(resA1.error.includes('substituído'));

      resolveA2({
        data: [{
          event: { id: 'event-A', title: 'Culto A Versão Atual' },
          items: [{ id: 'item-new', item_nature: 'liturgical', sequence_order: 1, title: 'Item Atual', planned_duration_seconds: 400 }],
        }],
        error: null,
      });

      const resA2 = await loadA2Promise;
      assert.equal(resA2.success, true);
      const evA = appCtx.events.find(e => e.id === 'event-A');
      assert.equal(evA.activities[0].title, 'Item Atual');
    });

    test('C6: validateLiturgicalReceipt suporta set_event_duration_policy, publish e draft com created_at ISO e bloqueia não-admin', async () => {
      // 1. set_event_duration_policy válido com duration_policy canônica ('warn' / 'block') sem duration_policy_minutes
      const validPolicyReceipt = validateLiturgicalReceipt([{
        command_id: 'cmd-p1',
        church_id: CHURCH_ID,
        action: 'set_event_duration_policy',
        result_entity_id: EVENT_ID,
        result_payload: { event_id: EVENT_ID, duration_policy: 'warn' },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-p1', CHURCH_ID, 'set_event_duration_policy');
      assert.ok(validPolicyReceipt);

      const validBlockReceipt = validateLiturgicalReceipt([{
        command_id: 'cmd-p1-b',
        church_id: CHURCH_ID,
        action: 'set_event_duration_policy',
        result_entity_id: EVENT_ID,
        result_payload: { event_id: EVENT_ID, duration_policy: 'block' },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-p1-b', CHURCH_ID, 'set_event_duration_policy');
      assert.ok(validBlockReceipt);

      // Contraprova: created_at inválido
      const invalidCreatedAt = validateLiturgicalReceipt([{
        command_id: 'cmd-p1',
        church_id: CHURCH_ID,
        action: 'set_event_duration_policy',
        result_entity_id: EVENT_ID,
        result_payload: { event_id: EVENT_ID, duration_policy: 'warn' },
        created_at: 'data-invalida',
      }], 'cmd-p1', CHURCH_ID, 'set_event_duration_policy');
      assert.equal(invalidCreatedAt, null);

      // Contraprova: ausência de duration_policy (sem minutes)
      const missingPolicy = validateLiturgicalReceipt([{
        command_id: 'cmd-p1',
        church_id: CHURCH_ID,
        action: 'set_event_duration_policy',
        result_entity_id: EVENT_ID,
        result_payload: { event_id: EVENT_ID },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-p1', CHURCH_ID, 'set_event_duration_policy');
      assert.equal(missingPolicy, null);

      // Contraprova: payload contendo apenas id e sem event_id deve ser estritamente rejeitado
      const idOnlyPolicyReceipt = validateLiturgicalReceipt([{
        command_id: 'cmd-p1-id',
        church_id: CHURCH_ID,
        action: 'set_event_duration_policy',
        result_entity_id: EVENT_ID,
        result_payload: { id: EVENT_ID, duration_policy: 'warn' },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-p1-id', CHURCH_ID, 'set_event_duration_policy');
      assert.equal(idOnlyPolicyReceipt, null);

      // Contraprova: política warning_only (não canônica do SQL 026)
      const warningOnlyPolicy = validateLiturgicalReceipt([{
        command_id: 'cmd-p1',
        church_id: CHURCH_ID,
        action: 'set_event_duration_policy',
        result_entity_id: EVENT_ID,
        result_payload: { event_id: EVENT_ID, duration_policy: 'warning_only' },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-p1', CHURCH_ID, 'set_event_duration_policy');
      assert.equal(warningOnlyPolicy, null);

      // Contraprova: política strict (não canônica do SQL 026)
      const strictPolicy = validateLiturgicalReceipt([{
        command_id: 'cmd-p1',
        church_id: CHURCH_ID,
        action: 'set_event_duration_policy',
        result_entity_id: EVENT_ID,
        result_payload: { event_id: EVENT_ID, duration_policy: 'strict' },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-p1', CHURCH_ID, 'set_event_duration_policy');
      assert.equal(strictPolicy, null);

      // Contraprova: política arbitrária
      const arbitraryPolicy = validateLiturgicalReceipt([{
        command_id: 'cmd-p1',
        church_id: CHURCH_ID,
        action: 'set_event_duration_policy',
        result_entity_id: EVENT_ID,
        result_payload: { event_id: EVENT_ID, duration_policy: 'arbitraria' },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-p1', CHURCH_ID, 'set_event_duration_policy');
      assert.equal(arbitraryPolicy, null);

      // Contraprova: event_id incompatível com result_entity_id
      const incompatiblePolicyEventId = validateLiturgicalReceipt([{
        command_id: 'cmd-p1',
        church_id: CHURCH_ID,
        action: 'set_event_duration_policy',
        result_entity_id: EVENT_ID,
        result_payload: { event_id: 'outro-evento-divergente', duration_policy: 'warn' },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-p1', CHURCH_ID, 'set_event_duration_policy');
      assert.equal(incompatiblePolicyEventId, null);

      // Contraprova: política fora do conjunto aceito pelo serviço
      const invalidPolicyRemote = await setEventDurationPolicyRemote({}, CHURCH_ID, EVENT_ID, 'politica_fora_do_conjunto');
      assert.equal(invalidPolicyRemote.success, false);
      assert.ok(invalidPolicyRemote.error.includes('Política inválida'));

      // 2. publish_event_program válido com estrutura canônica do SQL 026
      const validPublishReceipt = validateLiturgicalReceipt([{
        command_id: 'cmd-pub1',
        church_id: CHURCH_ID,
        action: 'publish_event_program',
        result_entity_id: EVENT_ID,
        result_payload: {
          event_id: EVENT_ID,
          program_version: 2,
          program_status: 'published',
          duration_policy: 'warn',
          published_at: '2026-11-21T10:00:00Z',
        },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-pub1', CHURCH_ID, 'publish_event_program');
      assert.ok(validPublishReceipt);

      // Contraprovas publish: duration_policy não-canônica (warning_only, strict, arbitrária, ausente)
      for (const badPol of ['warning_only', 'strict', 'arbitraria', null, undefined]) {
        const badPolReceipt = validateLiturgicalReceipt([{
          command_id: 'cmd-pub1',
          church_id: CHURCH_ID,
          action: 'publish_event_program',
          result_entity_id: EVENT_ID,
          result_payload: {
            event_id: EVENT_ID,
            program_version: 2,
            program_status: 'published',
            duration_policy: badPol,
            published_at: '2026-11-21T10:00:00Z',
          },
          created_at: '2026-11-21T10:00:00Z',
        }], 'cmd-pub1', CHURCH_ID, 'publish_event_program');
        assert.equal(badPolReceipt, null);
      }

      // Contraprovas publish: program_version não-canônica
      for (const badVer of ['2', ' 2 ', true, [2], '0x2', '1e0', null, undefined, 0, -1, 2.5, NaN, Infinity]) {
        const badVerReceipt = validateLiturgicalReceipt([{
          command_id: 'cmd-pub1',
          church_id: CHURCH_ID,
          action: 'publish_event_program',
          result_entity_id: EVENT_ID,
          result_payload: {
            event_id: EVENT_ID,
            program_version: badVer,
            program_status: 'published',
            duration_policy: 'warn',
            published_at: '2026-11-21T10:00:00Z',
          },
          created_at: '2026-11-21T10:00:00Z',
        }], 'cmd-pub1', CHURCH_ID, 'publish_event_program');
        assert.equal(badVerReceipt, null);
      }

      // Contraprovas publish: published_at ausente ou data inválida
      for (const badDate of [null, undefined, 'data-invalida', 12345]) {
        const badDateReceipt = validateLiturgicalReceipt([{
          command_id: 'cmd-pub1',
          church_id: CHURCH_ID,
          action: 'publish_event_program',
          result_entity_id: EVENT_ID,
          result_payload: {
            event_id: EVENT_ID,
            program_version: 2,
            program_status: 'published',
            duration_policy: 'warn',
            published_at: badDate,
          },
          created_at: '2026-11-21T10:00:00Z',
        }], 'cmd-pub1', CHURCH_ID, 'publish_event_program');
        assert.equal(badDateReceipt, null);
      }

      // Contraprova: publish com program_status !== 'published'
      const badStatusPublishReceipt = validateLiturgicalReceipt([{
        command_id: 'cmd-pub1',
        church_id: CHURCH_ID,
        action: 'publish_event_program',
        result_entity_id: EVENT_ID,
        result_payload: {
          event_id: EVENT_ID,
          program_version: 2,
          program_status: 'draft',
          duration_policy: 'warn',
          published_at: '2026-11-21T10:00:00Z',
        },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-pub1', CHURCH_ID, 'publish_event_program');
      assert.equal(badStatusPublishReceipt, null);

      // Contraprova: publish com event_id incompatível
      const incompatiblePublishEventId = validateLiturgicalReceipt([{
        command_id: 'cmd-pub1',
        church_id: CHURCH_ID,
        action: 'publish_event_program',
        result_entity_id: EVENT_ID,
        result_payload: {
          event_id: 'outro-evento-id',
          program_version: 2,
          program_status: 'published',
          duration_policy: 'warn',
          published_at: '2026-11-21T10:00:00Z',
        },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-pub1', CHURCH_ID, 'publish_event_program');
      assert.equal(incompatiblePublishEventId, null);

      // Contraprova: publish canônico mas com id no lugar de event_id deve ser rejeitado
      const idOnlyPublishReceipt = validateLiturgicalReceipt([{
        command_id: 'cmd-pub1-id',
        church_id: CHURCH_ID,
        action: 'publish_event_program',
        result_entity_id: EVENT_ID,
        result_payload: {
          id: EVENT_ID,
          program_version: 2,
          program_status: 'published',
          duration_policy: 'warn',
          published_at: '2026-11-21T10:00:00Z',
        },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-pub1-id', CHURCH_ID, 'publish_event_program');
      assert.equal(idOnlyPublishReceipt, null);

      // 3. save_event_program_draft válido com estrutura canônica do SQL 026
      const validDraftReceipt = validateLiturgicalReceipt([{
        command_id: 'cmd-d1',
        church_id: CHURCH_ID,
        action: 'save_event_program_draft',
        result_entity_id: EVENT_ID,
        result_payload: {
          event_id: EVENT_ID,
          program_version: 2,
          program_status: 'draft',
          published_at: null,
        },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-d1', CHURCH_ID, 'save_event_program_draft');
      assert.ok(validDraftReceipt);

      // Contraprovas draft: program_version não-canônica
      for (const badVer of ['2', ' 2 ', true, [2], '0x2', '1e0', null, undefined, 0, -1, 2.5, NaN, Infinity]) {
        const badVerDraftReceipt = validateLiturgicalReceipt([{
          command_id: 'cmd-d1',
          church_id: CHURCH_ID,
          action: 'save_event_program_draft',
          result_entity_id: EVENT_ID,
          result_payload: {
            event_id: EVENT_ID,
            program_version: badVer,
            program_status: 'draft',
            published_at: null,
          },
          created_at: '2026-11-21T10:00:00Z',
        }], 'cmd-d1', CHURCH_ID, 'save_event_program_draft');
        assert.equal(badVerDraftReceipt, null);
      }

      // Contraprova: draft com program_status !== 'draft'
      const badStatusDraftReceipt = validateLiturgicalReceipt([{
        command_id: 'cmd-d1',
        church_id: CHURCH_ID,
        action: 'save_event_program_draft',
        result_entity_id: EVENT_ID,
        result_payload: {
          event_id: EVENT_ID,
          program_version: 2,
          program_status: 'published',
          published_at: null,
        },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-d1', CHURCH_ID, 'save_event_program_draft');
      assert.equal(badStatusDraftReceipt, null);

      // Contraprova: draft com published_at inválido
      const badDateDraftReceipt = validateLiturgicalReceipt([{
        command_id: 'cmd-d1',
        church_id: CHURCH_ID,
        action: 'save_event_program_draft',
        result_entity_id: EVENT_ID,
        result_payload: {
          event_id: EVENT_ID,
          program_version: 2,
          program_status: 'draft',
          published_at: 'data-invalida',
        },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-d1', CHURCH_ID, 'save_event_program_draft');
      assert.equal(badDateDraftReceipt, null);

      // Contraprova: draft com event_id incompatível
      const incompatibleDraftEventId = validateLiturgicalReceipt([{
        command_id: 'cmd-d1',
        church_id: CHURCH_ID,
        action: 'save_event_program_draft',
        result_entity_id: EVENT_ID,
        result_payload: {
          event_id: 'outro-evento-id',
          program_version: 2,
          program_status: 'draft',
          published_at: null,
        },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-d1', CHURCH_ID, 'save_event_program_draft');
      assert.equal(incompatibleDraftEventId, null);

      // Contraprova: draft canônico mas com id no lugar de event_id deve ser rejeitado
      const idOnlyDraftReceipt = validateLiturgicalReceipt([{
        command_id: 'cmd-d1-id',
        church_id: CHURCH_ID,
        action: 'save_event_program_draft',
        result_entity_id: EVENT_ID,
        result_payload: {
          id: EVENT_ID,
          program_version: 2,
          program_status: 'draft',
          published_at: null,
        },
        created_at: '2026-11-21T10:00:00Z',
      }], 'cmd-d1-id', CHURCH_ID, 'save_event_program_draft');
      assert.equal(idOnlyDraftReceipt, null);

      let appCtx;
      const Consumer = () => {
        appCtx = useApp();
        return null;
      };

      await act(async () => {
        TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'lucas', churchId: CHURCH_ID },
            React.createElement(Consumer)
          )
        );
      });

      await act(async () => {
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Teste',
          activities: [],
          activitiesKnownInSession: true,
        }]);
        appCtx.selectEvent(EVENT_ID);
      });

      const resPub = appCtx.publishCurrentProgram();
      assert.equal(resPub.success, false);
      assert.ok(resPub.error.includes('Apenas administradores ou líderes'));
    });

    test('C7: getEventProgramRemote falha estruturalmente se items não for array e rejeita duração <= 0 sem fallback', async () => {
      const clientNullItems = {
        rpc: async () => ({
          data: [{
            event: { id: EVENT_ID, title: 'Culto' },
            items: null,
          }],
          error: null,
        }),
      };
      const resRemote = await getEventProgramRemote(clientNullItems, CHURCH_ID, EVENT_ID);
      assert.equal(resRemote.success, false);
      assert.ok(resRemote.error.includes('estrutura incompleta'));

      let appCtx;
      const Consumer = () => {
        appCtx = useApp();
        return null;
      };

      const clientInvalidDuration = {
        rpc: async () => ({
          data: [{
            event: { id: EVENT_ID, title: 'Culto com Item Zerado' },
            items: [
              { id: 'item-bad', item_nature: 'liturgical', sequence_order: 1, title: 'Etapa Inválida', planned_duration_seconds: 0 },
            ],
          }],
          error: null,
        }),
      };

      await act(async () => {
        TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: CHURCH_ID, supabaseClient: clientInvalidDuration },
            React.createElement(Consumer)
          )
        );
      });

      await act(async () => {
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Teste',
          loadedFromServer: true,
          activitiesKnownInSession: true,
        }]);
      });

      let loadRes;
      await act(async () => {
        loadRes = await appCtx.loadEventProgram(EVENT_ID);
      });

      assert.equal(loadRes.success, false);
      assert.ok(loadRes.error.includes('duração inválida'));
      const ev = appCtx.events.find(e => e.id === EVENT_ID);
      assert.equal(ev.activitiesKnownInSession, false);
      assert.ok(ev.programLoadError);
    });

    test('C8: Mutações são bloqueadas enquanto isProgramLoading estiver ativo', async () => {
      let appCtx;
      const Consumer = () => {
        appCtx = useApp();
        return null;
      };

      await act(async () => {
        TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: CHURCH_ID },
            React.createElement(Consumer)
          )
        );
      });

      await act(async () => {
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto em Carga',
          isProgramLoading: true,
          activities: [],
        }]);
        appCtx.selectEvent(EVENT_ID);
      });

      const resAdd = appCtx.addActivityToEvent({ title: 'Nova Etapa', plannedDurationMinutes: 10 });
      assert.equal(resAdd.success, false);
      assert.ok(resAdd.error.includes('carregada do servidor') || resAdd.error.includes('Aguarde'));

      const resAddParallel = await appCtx.addParallelServiceToCurrentEvent({ title: 'Apoio', plannedDurationMinutes: 30 });
      assert.equal(resAddParallel.success, false);
      assert.ok(resAddParallel.error.includes('carregada do servidor') || resAddParallel.error.includes('Aguarde'));
    });

    test('C9: prepRequiredMinutes inválido é estritamente rejeitado sem clamp [0..180]', async () => {
      const resNeg = await createEventItem({
        supabase: {},
        churchId: CHURCH_ID,
        commandId: 'cmd-c9-1',
        eventId: EVENT_ID,
        title: 'Apoio Negativo',
        itemNature: 'parallel_support',
        sequenceOrder: 1,
        plannedDurationSeconds: 1800,
        prepRequiredMinutes: -10,
      });
      assert.equal(resNeg.status, 'DEFINITIVE_ERROR');
      assert.ok(resNeg.message.includes('entre 0 e 180'));

      const resOver = await createEventItem({
        supabase: {},
        churchId: CHURCH_ID,
        commandId: 'cmd-c9-2',
        eventId: EVENT_ID,
        title: 'Apoio Acima',
        itemNature: 'parallel_support',
        sequenceOrder: 1,
        plannedDurationSeconds: 1800,
        prepRequiredMinutes: 240,
      });
      assert.equal(resOver.status, 'DEFINITIVE_ERROR');
      assert.ok(resOver.message.includes('entre 0 e 180'));

      const resDec = await createEventItem({
        supabase: {},
        churchId: CHURCH_ID,
        commandId: 'cmd-c9-3',
        eventId: EVENT_ID,
        title: 'Apoio Decimal',
        itemNature: 'parallel_support',
        sequenceOrder: 1,
        plannedDurationSeconds: 1800,
        prepRequiredMinutes: 15.5,
      });
      assert.equal(resDec.status, 'DEFINITIVE_ERROR');
      assert.ok(resDec.message.includes('entre 0 e 180'));

      const resUpdateDec = await updateEventItem({
        supabase: {},
        churchId: CHURCH_ID,
        commandId: 'cmd-c9-4',
        eventId: EVENT_ID,
        itemId: '00000000-0000-4000-8000-000000000022',
        title: 'Apoio Update Decimal',
        itemNature: 'parallel_support',
        plannedDurationSeconds: 1800,
        prepRequiredMinutes: 20.5,
        expectedUpdatedAt: '2026-11-21T09:00:00Z',
      });
      assert.equal(resUpdateDec.status, 'DEFINITIVE_ERROR');
      assert.ok(resUpdateDec.message.includes('entre 0 e 180'));

      const draftsWithBadPrep = buildParallelServiceDrafts([
        { id: 'serv-bad', title: 'Apoio com Prep Inválido', plannedDurationSeconds: 1200, prepRequiredMinutes: -5 },
      ], 0);

      const seqOutcome = await saveEventItemsSequentially({
        supabase: {},
        churchId: CHURCH_ID,
        eventId: EVENT_ID,
        drafts: draftsWithBadPrep,
        pendingCommandIds: new Map(),
      });
      assert.ok(seqOutcome.failed);
      assert.equal(seqOutcome.failed.uncertain, false);
      assert.ok(seqOutcome.failed.message.includes('entre 0 e 180'));
    });

    test('C10: Falha fechada sem program_version válido e reutilização idempotente de command_id em incerteza (publish, draft, policy)', async () => {
      // --- TESTES DIRETOS DOS WRAPPERS (set_event_duration_policy, publish_event_program, save_event_program_draft) ---
      const mockThrowClient = {
        rpc: async () => {
          throw new Error('falha de conexão / transporte (exceção)');
        },
      };
      const mockNoCodeClient = {
        rpc: async () => ({
          data: null,
          error: { message: 'falha de transporte simulada' },
        }),
      };
      const mockDefClient = {
        rpc: async () => ({
          data: null,
          error: { code: '42501', message: 'Permissão insuficiente no servidor.' },
        }),
      };

      // 1. setEventDurationPolicyRemote
      const resPolEx = await setEventDurationPolicyRemote(mockThrowClient, {
        churchId: CHURCH_ID,
        commandId: 'cmd-pol-ex',
        eventId: EVENT_ID,
        durationPolicy: 'warn',
      });
      assert.equal(resPolEx.success, false);
      assert.equal(resPolEx.uncertain, true);
      assert.ok(resPolEx.rawError);
      assert.equal(resPolEx.rawError.message, 'falha de conexão / transporte (exceção)');

      const resPolNoCode = await setEventDurationPolicyRemote(mockNoCodeClient, {
        churchId: CHURCH_ID,
        commandId: 'cmd-pol-nocode',
        eventId: EVENT_ID,
        durationPolicy: 'warn',
      });
      assert.equal(resPolNoCode.success, false);
      assert.equal(resPolNoCode.uncertain, true);
      assert.ok(resPolNoCode.rawError);
      assert.equal(resPolNoCode.rawError.message, 'falha de transporte simulada');

      const resPolDef = await setEventDurationPolicyRemote(mockDefClient, {
        churchId: CHURCH_ID,
        commandId: 'cmd-pol-def',
        eventId: EVENT_ID,
        durationPolicy: 'warn',
      });
      assert.equal(resPolDef.success, false);
      assert.equal(resPolDef.uncertain, false);

      // 2. publishEventProgramRemote
      const resPubEx = await publishEventProgramRemote(mockThrowClient, {
        churchId: CHURCH_ID,
        commandId: 'cmd-pub-ex',
        eventId: EVENT_ID,
      });
      assert.equal(resPubEx.success, false);
      assert.equal(resPubEx.uncertain, true);
      assert.ok(resPubEx.rawError);
      assert.equal(resPubEx.rawError.message, 'falha de conexão / transporte (exceção)');

      const resPubNoCode = await publishEventProgramRemote(mockNoCodeClient, {
        churchId: CHURCH_ID,
        commandId: 'cmd-pub-nocode',
        eventId: EVENT_ID,
      });
      assert.equal(resPubNoCode.success, false);
      assert.equal(resPubNoCode.uncertain, true);
      assert.ok(resPubNoCode.rawError);
      assert.equal(resPubNoCode.rawError.message, 'falha de transporte simulada');

      const resPubDef = await publishEventProgramRemote(mockDefClient, {
        churchId: CHURCH_ID,
        commandId: 'cmd-pub-def',
        eventId: EVENT_ID,
      });
      assert.equal(resPubDef.success, false);
      assert.equal(resPubDef.uncertain, false);

      // 3. saveEventProgramDraftRemote
      const resDraftEx = await saveEventProgramDraftRemote(mockThrowClient, {
        churchId: CHURCH_ID,
        commandId: 'cmd-draft-ex',
        eventId: EVENT_ID,
      });
      assert.equal(resDraftEx.success, false);
      assert.equal(resDraftEx.uncertain, true);
      assert.ok(resDraftEx.rawError);
      assert.equal(resDraftEx.rawError.message, 'falha de conexão / transporte (exceção)');

      const resDraftNoCode = await saveEventProgramDraftRemote(mockNoCodeClient, {
        churchId: CHURCH_ID,
        commandId: 'cmd-draft-nocode',
        eventId: EVENT_ID,
      });
      assert.equal(resDraftNoCode.success, false);
      assert.equal(resDraftNoCode.uncertain, true);
      assert.ok(resDraftNoCode.rawError);
      assert.equal(resDraftNoCode.rawError.message, 'falha de transporte simulada');

      const resDraftDef = await saveEventProgramDraftRemote(mockDefClient, {
        churchId: CHURCH_ID,
        commandId: 'cmd-draft-def',
        eventId: EVENT_ID,
      });
      assert.equal(resDraftDef.success, false);
      assert.equal(resDraftDef.uncertain, false);

      // --- TESTES INTEGRADOS COM APPCONTEXT ---
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let simulatedAction = null;
      let shouldFailUncertain = false;
      let shouldFailDefinitive = false;
      let shouldThrowTransportException = false;
      let shouldReturnTransportErrorWithoutCode = false;
      let customPayload = null;
      const capturedCommandIds = [];

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'get_event_program') {
            return {
              data: {
                success: true,
                event: {
                  id: EVENT_ID,
                  church_id: CHURCH_ID,
                  program_version: 1,
                  program_status: 'draft',
                  duration_policy: 'warn',
                },
                items: [],
              },
              error: null,
            };
          }
          if (fn === simulatedAction) {
            capturedCommandIds.push(params.p_command_id);
            if (shouldThrowTransportException) {
              throw new Error('falha de conexão / transporte (exceção)');
            }
            if (shouldReturnTransportErrorWithoutCode) {
              return { data: null, error: { message: 'falha de transporte simulada' } };
            }
            if (shouldFailUncertain) {
              // Resposta sem recibo canônico compatível para simular incerteza
              return { data: null, error: null };
            }
            if (shouldFailDefinitive) {
              // Erro definitivo canônico (ex.: código 42501 - privilégio insuficiente)
              return { data: null, error: { code: '42501', message: 'Permissão insuficiente no servidor.' } };
            }
            const row = {
              command_id: params.p_command_id,
              action: fn,
              church_id: params.p_church_id,
              result_entity_id: params.p_event_id,
              result_payload: customPayload || {
                event_id: params.p_event_id,
                program_version: 2,
                program_status: fn === 'publish_event_program' ? 'published' : 'draft',
                duration_policy: 'warn',
                published_at: fn === 'publish_event_program' ? '2026-11-21T10:00:00Z' : null,
              },
              created_at: '2026-11-21T10:00:00Z',
            };
            return {
              data: [row],
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
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Idempotência e Versões',
          status: 'scheduled',
          programVersion: 1,
          programStatus: 'draft',
          activities: [],
          parallelServices: [],
          loadedFromServer: true,
          activitiesKnownInSession: true,
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      // --- PARTE 1: Falha fechada em publishCurrentProgram sem program_version canônico ---
      simulatedAction = 'publish_event_program';
      shouldFailUncertain = false;
      shouldFailDefinitive = false;
      shouldThrowTransportException = false;
      shouldReturnTransportErrorWithoutCode = false;

      // Contraprova estrita de todos os tipos não-canônicos: "2", " 2 ", true, [2], "0x2", "1e0", null, undefined, 0, -1, 2.5, NaN, Infinity
      const nonCanonicalVersions = ['2', ' 2 ', true, [2], '0x2', '1e0', null, undefined, 0, -1, 2.5, NaN, Infinity];
      for (const badVer of nonCanonicalVersions) {
        customPayload = {
          event_id: EVENT_ID,
          program_version: badVer,
          program_status: 'published',
          duration_policy: 'warn',
          published_at: '2026-11-21T10:00:00Z',
        };
        let resPubBad;
        await act(async () => {
          resPubBad = await appCtx.publishCurrentProgram();
        });
        assert.equal(resPubBad.success, false);
        assert.equal(resPubBad.uncertain, true);
        // Estado local DEVE ser estritamente preservado: não pode fabricar v2
        assert.equal(appCtx.event.programVersion, 1);
        assert.equal(appCtx.event.programStatus, 'draft');
      }

      // --- PARTE 2: publishCurrentProgram (Caso A: Exceção de Transporte e Reutilização) ---
      capturedCommandIds.length = 0;
      shouldThrowTransportException = true;
      shouldReturnTransportErrorWithoutCode = false;
      shouldFailUncertain = false;
      shouldFailDefinitive = false;
      customPayload = null;

      let pubA1;
      await act(async () => {
        pubA1 = await appCtx.publishCurrentProgram();
      });
      assert.equal(pubA1.success, false);
      assert.equal(pubA1.uncertain, true);
      const pubACmd1 = capturedCommandIds[0];
      assert.ok(pubACmd1);

      // 2ª chamada: reutiliza exatamente o mesmo command_id
      shouldThrowTransportException = false;
      customPayload = {
        event_id: EVENT_ID,
        program_version: 2,
        program_status: 'published',
        duration_policy: 'warn',
        published_at: '2026-11-21T10:00:00Z',
      };
      let pubA2;
      await act(async () => {
        pubA2 = await appCtx.publishCurrentProgram();
      });
      assert.equal(pubA2.success, true);
      const pubACmd2 = capturedCommandIds[1];
      assert.equal(pubACmd2, pubACmd1, 'publishCurrentProgram deve reutilizar exatamente o mesmo command_id após exceção');

      // --- PARTE 2B: publishCurrentProgram (Caso B: Erro sem código, Reutilização e Contraprova Definitiva) ---
      capturedCommandIds.length = 0;
      shouldThrowTransportException = false;
      shouldReturnTransportErrorWithoutCode = true;
      shouldFailUncertain = false;
      shouldFailDefinitive = false;
      customPayload = null;

      let pubB1;
      await act(async () => {
        pubB1 = await appCtx.publishCurrentProgram();
      });
      assert.equal(pubB1.success, false);
      assert.equal(pubB1.uncertain, true);
      const pubBCmd1 = capturedCommandIds[0];
      assert.ok(pubBCmd1);

      // 2ª chamada: erro sem código faz reusar o ID; simulamos falha definitiva (42501) para conferir limpeza
      shouldReturnTransportErrorWithoutCode = false;
      shouldFailDefinitive = true;
      let pubB2;
      await act(async () => {
        pubB2 = await appCtx.publishCurrentProgram();
      });
      assert.equal(pubB2.success, false);
      assert.notEqual(pubB2.uncertain, true);
      const pubBCmd2 = capturedCommandIds[1];
      assert.equal(pubBCmd2, pubBCmd1, 'publishCurrentProgram deve reutilizar exatamente o mesmo command_id após erro sem código');

      // Contraprova definitiva: pendência foi eliminada -> gera novo command_id
      shouldFailDefinitive = false;
      customPayload = {
        event_id: EVENT_ID,
        program_version: 2,
        program_status: 'published',
        duration_policy: 'warn',
        published_at: '2026-11-21T10:00:00Z',
      };
      let pubB3;
      await act(async () => {
        pubB3 = await appCtx.publishCurrentProgram();
      });
      assert.equal(pubB3.success, true);
      const pubBCmd3 = capturedCommandIds[2];
      assert.ok(pubBCmd3);
      assert.notEqual(pubBCmd3, pubBCmd1, 'publishCurrentProgram deve gerar novo command_id após erro definitivo');
      assert.equal(appCtx.event.programVersion, 2);
      assert.equal(appCtx.event.programStatus, 'published');

      // --- PARTE 3: Falha fechada em saveCurrentProgramDraft sem program_version canônico ---
      simulatedAction = 'save_event_program_draft';
      shouldFailUncertain = false;
      shouldFailDefinitive = false;
      shouldThrowTransportException = false;
      shouldReturnTransportErrorWithoutCode = false;

      for (const badVer of nonCanonicalVersions) {
        customPayload = {
          event_id: EVENT_ID,
          program_version: badVer,
          program_status: 'draft',
          published_at: null,
        };
        let resDraftBad;
        await act(async () => {
          resDraftBad = await appCtx.saveCurrentProgramDraft();
        });
        assert.equal(resDraftBad.success, false);
        assert.equal(resDraftBad.uncertain, true);
        assert.equal(appCtx.event.programVersion, 2);
        assert.equal(appCtx.event.programStatus, 'published');
      }

      // --- PARTE 4: saveCurrentProgramDraft (Caso A: Exceção de Transporte e Reutilização) ---
      capturedCommandIds.length = 0;
      shouldThrowTransportException = true;
      shouldReturnTransportErrorWithoutCode = false;
      shouldFailUncertain = false;
      shouldFailDefinitive = false;
      customPayload = null;

      let draftA1;
      await act(async () => {
        draftA1 = await appCtx.saveCurrentProgramDraft();
      });
      assert.equal(draftA1.success, false);
      assert.equal(draftA1.uncertain, true);
      const draftACmd1 = capturedCommandIds[0];
      assert.ok(draftACmd1);

      // 2ª chamada: reutiliza exatamente o mesmo command_id
      shouldThrowTransportException = false;
      customPayload = {
        event_id: EVENT_ID,
        program_version: 2,
        program_status: 'draft',
        published_at: null,
      };
      let draftA2;
      await act(async () => {
        draftA2 = await appCtx.saveCurrentProgramDraft();
      });
      assert.equal(draftA2.success, true);
      const draftACmd2 = capturedCommandIds[1];
      assert.equal(draftACmd2, draftACmd1, 'saveCurrentProgramDraft deve reutilizar exatamente o mesmo command_id após exceção');

      // --- PARTE 4B: saveCurrentProgramDraft (Caso B: Erro sem código, Reutilização e Contraprova Definitiva) ---
      capturedCommandIds.length = 0;
      shouldThrowTransportException = false;
      shouldReturnTransportErrorWithoutCode = true;
      shouldFailUncertain = false;
      shouldFailDefinitive = false;
      customPayload = null;

      let draftB1;
      await act(async () => {
        draftB1 = await appCtx.saveCurrentProgramDraft();
      });
      assert.equal(draftB1.success, false);
      assert.equal(draftB1.uncertain, true);
      const draftBCmd1 = capturedCommandIds[0];
      assert.ok(draftBCmd1);

      // 2ª chamada: reutiliza o mesmo ID e recebe erro definitivo
      shouldReturnTransportErrorWithoutCode = false;
      shouldFailDefinitive = true;
      let draftB2;
      await act(async () => {
        draftB2 = await appCtx.saveCurrentProgramDraft();
      });
      assert.equal(draftB2.success, false);
      assert.notEqual(draftB2.uncertain, true);
      const draftBCmd2 = capturedCommandIds[1];
      assert.equal(draftBCmd2, draftBCmd1, 'saveCurrentProgramDraft deve reutilizar exatamente o mesmo command_id após erro sem código');

      // Contraprova definitiva: pendência eliminada -> gera novo ID
      shouldFailDefinitive = false;
      customPayload = {
        event_id: EVENT_ID,
        program_version: 2,
        program_status: 'draft',
        published_at: null,
      };
      let draftB3;
      await act(async () => {
        draftB3 = await appCtx.saveCurrentProgramDraft();
      });
      assert.equal(draftB3.success, true);
      const draftBCmd3 = capturedCommandIds[2];
      assert.ok(draftBCmd3);
      assert.notEqual(draftBCmd3, draftBCmd1, 'saveCurrentProgramDraft deve gerar novo command_id após erro definitivo');
      assert.equal(appCtx.event.programVersion, 2);
      assert.equal(appCtx.event.programStatus, 'draft');

      // --- PARTE 5: set_event_duration_policy (Caso A: Exceção de Transporte e Reutilização) ---
      simulatedAction = 'set_event_duration_policy';
      capturedCommandIds.length = 0;
      shouldThrowTransportException = true;
      shouldReturnTransportErrorWithoutCode = false;
      shouldFailUncertain = false;
      shouldFailDefinitive = false;
      customPayload = null;

      let polA1;
      await act(async () => {
        polA1 = await appCtx.setEventDurationPolicy('warn', EVENT_ID);
      });
      assert.equal(polA1.success, false);
      assert.equal(polA1.uncertain, true);
      const polACmd1 = capturedCommandIds[0];
      assert.ok(polACmd1);

      // 2ª chamada: reutiliza o mesmo command_id
      shouldThrowTransportException = false;
      customPayload = { event_id: EVENT_ID, duration_policy: 'warn' };
      let polA2;
      await act(async () => {
        polA2 = await appCtx.setEventDurationPolicy('warn', EVENT_ID);
      });
      assert.equal(polA2.success, true);
      const polACmd2 = capturedCommandIds[1];
      assert.equal(polACmd2, polACmd1, 'setEventDurationPolicy deve reutilizar exatamente o mesmo command_id após exceção');

      // --- PARTE 5B: set_event_duration_policy (Caso B: Erro sem código, Reutilização e Contraprova Definitiva) ---
      capturedCommandIds.length = 0;
      shouldThrowTransportException = false;
      shouldReturnTransportErrorWithoutCode = true;
      shouldFailUncertain = false;
      shouldFailDefinitive = false;
      customPayload = null;

      let polB1;
      await act(async () => {
        polB1 = await appCtx.setEventDurationPolicy('warn', EVENT_ID);
      });
      assert.equal(polB1.success, false);
      assert.equal(polB1.uncertain, true);
      const polBCmd1 = capturedCommandIds[0];
      assert.ok(polBCmd1);

      // 2ª chamada: reutiliza o mesmo ID e recebe erro definitivo
      shouldReturnTransportErrorWithoutCode = false;
      shouldFailDefinitive = true;
      let polB2;
      await act(async () => {
        polB2 = await appCtx.setEventDurationPolicy('warn', EVENT_ID);
      });
      assert.equal(polB2.success, false);
      assert.notEqual(polB2.uncertain, true);
      const polBCmd2 = capturedCommandIds[1];
      assert.equal(polBCmd2, polBCmd1, 'setEventDurationPolicy deve reutilizar exatamente o mesmo command_id após erro sem código');

      // Contraprova definitiva: pendência eliminada -> gera novo ID
      shouldFailDefinitive = false;
      customPayload = { event_id: EVENT_ID, duration_policy: 'warn' };
      let polB3;
      await act(async () => {
        polB3 = await appCtx.setEventDurationPolicy('warn', EVENT_ID);
      });
      assert.equal(polB3.success, true);
      const polBCmd3 = capturedCommandIds[2];
      assert.ok(polBCmd3);
      assert.notEqual(polBCmd3, polBCmd1, 'setEventDurationPolicy deve gerar novo command_id após erro definitivo');
    });

    test('C11: modo block com excesso bloqueia publicação na UI e aviso de edição descreve persistência real', () => {
      assert.equal(isProgramPublicationBlocked('block', 20), true);
      assert.equal(isProgramPublicationBlocked('block', 0), false);
      assert.equal(isProgramPublicationBlocked('block', -1), false);
      assert.equal(isProgramPublicationBlocked('warn', 20), false);
      assert.equal(isProgramPublicationBlocked(null, 20), false);
      assert.equal(isProgramPublicationBlocked('block', Number.NaN), false);

      const planningViewSource = fs.readFileSync(
        path.resolve('src/components/PlanningView.jsx'),
        'utf-8'
      );
      assert.ok(
        planningViewSource.includes('isProgramMutationsDisabled || isPublicationBlockedByDuration'),
        'o botão de publicação deve permanecer desabilitado no modo block com excesso'
      );
      assert.ok(
        planningViewSource.includes('if (isPublicationBlockedByDuration)'),
        'o handler de publicação deve falhar fechado mesmo fora do clique normal do botão'
      );
      assert.equal(
        planningViewSource.includes('A edição de etapa ainda não é gravada no servidor'),
        false,
        'o aviso obsoleto de edição apenas local não pode permanecer na interface'
      );
      assert.ok(
        planningViewSource.includes('Ao salvar uma etapa já sincronizada, título, duração e responsável são gravados no servidor.'),
        'o aviso deve distinguir a persistência remota de uma etapa já sincronizada'
      );
      assert.ok(
        planningViewSource.includes('Em etapas ainda locais, as alterações permanecem somente nesta sessão.'),
        'o aviso deve informar que etapas ainda locais não são gravadas no servidor'
      );
    });

    test('C12: reordenação incerta preserva estado, reutiliza command_id e bloqueia ordem divergente com aviso visível', async () => {
      let appCtx = null;
      let renderer = null;
      let reorderMode = 'uncertain';
      const capturedReorders = [];

      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'reorder_event_items') {
            capturedReorders.push({
              commandId: params.p_command_id,
              itemIds: [...params.p_ordered_item_ids],
            });
            if (reorderMode === 'definitive') {
              return {
                data: null,
                error: { code: '42501', message: 'Permissão insuficiente no servidor.' },
              };
            }
            return {
              data: null,
              error: { message: 'falha de transporte simulada na reordenação' },
            };
          }
          return { data: [], error: null };
        },
      };

      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            AppProvider,
            { initialUserId: 'marcos', churchId: CHURCH_ID, supabaseClient: mockClient },
            React.createElement(
              React.Fragment,
              null,
              React.createElement(Consumer),
              React.createElement(PlanningView)
            )
          )
        );
      });

      const originalActivities = [
        { id: 'act-1', sequenceOrder: 1, title: 'Abertura', category: 'Liturgia', plannedDurationMinutes: 10, persisted: true },
        { id: 'act-2', sequenceOrder: 2, title: 'Louvor', category: 'Liturgia', plannedDurationMinutes: 20, persisted: true },
        { id: 'act-3', sequenceOrder: 3, title: 'Palavra', category: 'Liturgia', plannedDurationMinutes: 30, persisted: true },
      ];

      await act(async () => {
        appCtx.setEvents([{
          id: EVENT_ID,
          title: 'Culto Reordenação Incerta',
          status: 'scheduled',
          programStatus: 'draft',
          durationPolicy: 'warn',
          plannedDurationMinutes: 105,
          loadedFromServer: true,
          programLoadedFromServer: true,
          activitiesKnownInSession: true,
          activities: originalActivities,
          parallelServices: [],
        }]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      assert.equal(appCtx.isOnline, true);
      assert.equal(
        appCtx.isDataStale,
        false,
        JSON.stringify({ remoteError: appCtx.remoteError, event: appCtx.event })
      );
      assert.notEqual(appCtx.event?.isProgramLoading, true);
      assert.equal(appCtx.event?.programLoadError, undefined);
      assert.equal(appCtx.event?.activitiesKnownInSession, true);

      const moveUpButton = renderer.root.findByProps({ id: 'btn-move-up-act-2' });
      let firstResult;
      await act(async () => {
        firstResult = await moveUpButton.props.onClick();
      });

      assert.equal(firstResult.success, false);
      assert.equal(firstResult.uncertain, true, JSON.stringify(firstResult));
      assert.equal(capturedReorders.length, 1, 'resultado incerto não pode disparar repetição automática');
      assert.deepEqual(capturedReorders[0].itemIds, ['act-2', 'act-1', 'act-3']);
      assert.deepEqual(
        appCtx.event.activities.map(activity => activity.id),
        ['act-1', 'act-2', 'act-3'],
        'estado local deve permanecer inalterado enquanto o servidor não confirma a reordenação'
      );

      const reorderBanner = renderer.root.findByProps({ id: 'banner-reorder-activity-error' });
      const reorderMessage = reorderBanner.findByType('p').children.join('');
      assert.ok(reorderMessage.includes('Resultado incerto ao reordenar'));
      assert.ok(reorderMessage.includes('Recarregue a programação'));
      assert.ok(reorderMessage.includes('repita exatamente o mesmo movimento'));

      let divergentResult;
      await act(async () => {
        divergentResult = await appCtx.moveActivityUpInEvent('act-3');
      });
      assert.equal(divergentResult.success, false);
      assert.equal(divergentResult.uncertain, true);
      assert.equal(divergentResult.pendingConflict, true);
      assert.equal(capturedReorders.length, 1, 'ordem divergente deve ser bloqueada antes da RPC');

      reorderMode = 'definitive';
      let identicalRetryResult;
      await act(async () => {
        identicalRetryResult = await appCtx.moveActivityUpInEvent('act-2');
      });
      assert.equal(identicalRetryResult.success, false);
      assert.notEqual(identicalRetryResult.uncertain, true);
      assert.equal(capturedReorders.length, 2);
      assert.equal(
        capturedReorders[1].commandId,
        capturedReorders[0].commandId,
        'repetição idêntica deve reutilizar exatamente o mesmo command_id'
      );

      reorderMode = 'uncertain';
      let afterDefinitiveResult;
      await act(async () => {
        afterDefinitiveResult = await appCtx.moveActivityUpInEvent('act-2');
      });
      assert.equal(afterDefinitiveResult.success, false);
      assert.equal(afterDefinitiveResult.uncertain, true);
      assert.equal(capturedReorders.length, 3);
      assert.notEqual(
        capturedReorders[2].commandId,
        capturedReorders[0].commandId,
        'erro definitivo deve limpar a pendência e permitir novo command_id'
      );

      await act(async () => {
        renderer.unmount();
      });
    });

    test('C13: trava síncrona evita RPC concorrente, diferencia o banner e limpa a mensagem ao trocar de evento', async () => {
      let appCtx = null;
      let renderer = null;
      let reorderMode = 'pending';
      let releasePendingReorder = null;
      let reorderRpcCount = 0;

      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const emptyQuery = new Proxy({}, {
        get: (_target, property) => {
          if (property === 'then') {
            return (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          return () => emptyQuery;
        },
      });

      const mockClient = {
        from: () => emptyQuery,
        rpc: async (fn) => {
          if (fn === 'reorder_event_items') {
            reorderRpcCount++;
            if (reorderMode === 'pending') {
              return new Promise(resolve => {
                releasePendingReorder = () => resolve({
                  data: null,
                  error: { message: 'falha de transporte concorrente simulada' },
                });
              });
            }
            return {
              data: null,
              error: { code: '42501', message: 'Permissão insuficiente no servidor.' },
            };
          }
          return { data: [], error: null };
        },
      };

      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            AppProvider,
            { initialUserId: 'marcos', churchId: CHURCH_ID, supabaseClient: mockClient },
            React.createElement(
              React.Fragment,
              null,
              React.createElement(Consumer),
              React.createElement(PlanningView)
            )
          )
        );
      });

      const activities = [
        { id: 'act-race-1', sequenceOrder: 1, title: 'Abertura', category: 'Liturgia', plannedDurationMinutes: 10, persisted: true },
        { id: 'act-race-2', sequenceOrder: 2, title: 'Louvor', category: 'Liturgia', plannedDurationMinutes: 20, persisted: true },
      ];
      const firstEvent = {
        id: EVENT_ID,
        title: 'Culto Trava de Reordenação',
        status: 'scheduled',
        programStatus: 'draft',
        durationPolicy: 'warn',
        plannedDurationMinutes: 105,
        loadedFromServer: true,
        programLoadedFromServer: true,
        activitiesKnownInSession: true,
        activities,
        parallelServices: [],
      };

      await act(async () => {
        appCtx.setEvents([firstEvent]);
        appCtx.setCurrentEventId(EVENT_ID);
      });

      const moveButton = renderer.root.findByProps({ id: 'btn-move-up-act-race-2' });
      let firstPromise;
      await act(async () => {
        firstPromise = moveButton.props.onClick();
        await Promise.resolve();
      });
      assert.equal(reorderRpcCount, 1);
      assert.equal(typeof releasePendingReorder, 'function');

      let concurrentResult;
      await act(async () => {
        concurrentResult = await moveButton.props.onClick();
      });
      assert.equal(concurrentResult.success, false);
      assert.ok(concurrentResult.error.includes('temporariamente indisponível'));
      assert.equal(reorderRpcCount, 1, 'dois disparos síncronos devem produzir somente uma RPC');

      let firstResult;
      await act(async () => {
        releasePendingReorder();
        firstResult = await firstPromise;
      });
      assert.equal(firstResult.success, false);
      assert.equal(firstResult.uncertain, true);

      let banner = renderer.root.findByProps({ id: 'banner-reorder-activity-error' });
      assert.equal(banner.findByType('span').children.join(''), 'Não foi possível confirmar a reordenação');

      reorderMode = 'definitive';
      let definitiveResult;
      await act(async () => {
        definitiveResult = await renderer.root.findByProps({ id: 'btn-move-up-act-race-2' }).props.onClick();
      });
      assert.equal(definitiveResult.success, false);
      assert.notEqual(definitiveResult.uncertain, true);
      assert.equal(reorderRpcCount, 2);

      banner = renderer.root.findByProps({ id: 'banner-reorder-activity-error' });
      assert.equal(banner.findByType('span').children.join(''), 'Não foi possível reordenar a etapa');

      const secondEventId = '00000000-0000-4000-8000-000000000100';
      await act(async () => {
        appCtx.setEvents([
          firstEvent,
          {
            ...firstEvent,
            id: secondEventId,
            title: 'Outro Culto',
            activities: [],
          },
        ]);
        appCtx.setCurrentEventId(secondEventId);
      });
      assert.equal(renderer.root.findAllByProps({ id: 'banner-reorder-activity-error' }).length, 0);

      await act(async () => {
        renderer.unmount();
      });
    });
  });
});
