import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {
  parseInstantInTimeZone,
  validateEventEdition,
  createEventEditionObject,
  extractChurchEventsFromRpc,
  toPlanningEventFromServer,
  mergeServerEventsWithSession,
  createChurchEventEditionRemote,
  formatInstantInTimeZone,
} from '../src/utils/eventPlanningService.js';

const CHURCH_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_CALLER = { id: 'adm-1', roles: ['admin'], isAdmin: true };

// Bundle JSX dos componentes React para execução segura em Node.js
const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'issue-28-planning-components.bundle.mjs');
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
const { AppProvider, PlanningView, useApp } = await import(pathToFileURL(bundlePath).href);

function canonicalCreateEventReceipt(params, eventId = 'ev-new-1') {
  return {
    data: [{
      command_id: params.p_command_id,
      action: 'create_church_event_edition',
      church_id: params.p_church_id,
      result_entity_id: eventId,
      result_payload: { event_id: eventId },
      created_at: '2026-11-01T00:00:00Z',
    }],
    error: null,
  };
}

function extractNodeText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join(' ');
  if (Array.isArray(node.children)) return node.children.map(extractNodeText).join(' ');
  return '';
}

describe('Issue #28 — Tela Real de Planejamento (Listagem, Fuso, Recibo, Opção B e Catálogo)', () => {
  describe('Listagem e mesclagem de eventos do servidor', () => {
    test('extractChurchEventsFromRpc extrai eventos de { events, total_count } (objeto ou array de 1 linha)', () => {
      const sample = [
        { id: 'ev-1', title: 'Culto Domingo', event_type: 'Culto', status: 'scheduled' },
        { id: 'ev-2', title: 'Culto Quarta', event_type: 'Oração', status: 'in_progress' },
      ];

      const fromRow = extractChurchEventsFromRpc([{ events: sample, total_count: 2 }]);
      assert.equal(fromRow.length, 2);
      assert.equal(fromRow[0].id, 'ev-1');

      const fromObj = extractChurchEventsFromRpc({ events: sample, total_count: 2 });
      assert.equal(fromObj.length, 2);
      assert.equal(fromObj[1].id, 'ev-2');
    });

    test('extractChurchEventsFromRpc retorna lista vazia para { events: [], total_count: 0 } sem criar evento-fantasma', () => {
      const result = extractChurchEventsFromRpc([{ events: [], total_count: 0 }]);
      assert.deepEqual(result, []);
    });

    test('extractChurchEventsFromRpc retorna null para formato não reconhecido', () => {
      assert.equal(extractChurchEventsFromRpc(null), null);
      assert.equal(extractChurchEventsFromRpc(undefined), null);
      assert.equal(extractChurchEventsFromRpc({ unexpected: true }), null);
      assert.equal(extractChurchEventsFromRpc([{ events: null, total_count: 0 }]), null);
    });

    test('toPlanningEventFromServer mantém campos não retornados pela RPC como null e marca loadedFromServer', () => {
      const mapped = toPlanningEventFromServer({
        id: 'ev-srv-1',
        title: 'Culto da Família',
        event_type: 'Culto',
        status: 'scheduled',
        planned_start_at: '2026-11-15T22:00:00.000Z',
        planned_end_at: '2026-11-16T00:00:00.000Z',
      }, 'America/Sao_Paulo');

      assert.equal(mapped.id, 'ev-srv-1');
      assert.equal(mapped.type, 'Culto');
      assert.equal(mapped.status, 'pronto');
      assert.equal(mapped.date, '2026-11-15');
      assert.equal(mapped.scheduledStartTime, '19:00');
      assert.equal(mapped.plannedDurationMinutes, 120);
      assert.equal(mapped.durationPolicy, null);
      assert.equal(mapped.programStatus, null);
      assert.equal(mapped.programVersion, null);
      assert.equal(mapped.loadedFromServer, true);
      assert.equal(mapped.activitiesKnownInSession, false);
      assert.deepEqual(mapped.activities, []);
    });

    test('mergeServerEventsWithSession preserva campos de sessão em eventos existentes e mantém activitiesKnownInSession correto', () => {
      const sessionCreated = {
        id: 'ev-1',
        title: 'Culto Local',
        loadedFromServer: false,
        activitiesKnownInSession: true,
        durationPolicy: 'warn',
        programStatus: 'draft',
        programVersion: 1,
        activities: [{ id: 'act-1', title: 'Oração' }],
        parallelServices: [{ id: 'ps-1', title: 'Som' }],
        checklist: [{ id: 'chk-1', done: true }],
        internalAlerts: ['Aviso'],
      };

      const serverList = [
        toPlanningEventFromServer({
          id: 'ev-1',
          title: 'Culto Atualizado',
          event_type: 'Culto',
          status: 'scheduled',
          planned_start_at: '2026-11-15T22:00:00.000Z',
          planned_end_at: '2026-11-15T23:30:00.000Z',
        }, 'America/Sao_Paulo'),
        toPlanningEventFromServer({
          id: 'ev-2',
          title: 'Culto Novo do Servidor',
          event_type: 'Culto',
          status: 'scheduled',
          planned_start_at: '2026-11-18T22:00:00.000Z',
          planned_end_at: '2026-11-18T23:30:00.000Z',
        }, 'America/Sao_Paulo'),
      ];

      const merged = mergeServerEventsWithSession(serverList, [sessionCreated]);
      assert.equal(merged.length, 2);

      const ev1 = merged.find(e => e.id === 'ev-1');
      assert.equal(ev1.title, 'Culto Atualizado');
      assert.equal(ev1.durationPolicy, 'warn');
      assert.equal(ev1.activities.length, 1);
      assert.equal(ev1.activitiesKnownInSession, true);

      const ev2 = merged.find(e => e.id === 'ev-2');
      assert.equal(ev2.durationPolicy, null);
      assert.equal(ev2.loadedFromServer, true);
      assert.equal(ev2.activitiesKnownInSession, false);
    });
  });

  describe('Fuso horário da igreja, datas inválidas e hora inexistente em DST (4.4)', () => {
    test('validateEventEdition interpreta data/hora local no fuso da igreja (não no fuso do processo) e calcula duração igual à enviada', () => {
      const res = validateEventEdition({
        title: 'Culto em Manaus',
        plannedStartAt: '2026-11-15T19:00',
        plannedEndAt: '2026-11-15T20:45',
        durationPolicy: 'warn',
      }, { timezone: 'America/Manaus' }, ADMIN_CALLER);

      assert.equal(res.valid, true);
      assert.equal(res.timezone, 'America/Manaus');
      assert.equal(res.plannedStartAt, '2026-11-15T23:00:00.000Z');
      assert.equal(res.plannedEndAt, '2026-11-16T00:45:00.000Z');
      assert.equal(res.plannedDurationMinutes, 105);

      const sentDurationMin = Math.round((Date.parse(res.plannedEndAt) - Date.parse(res.plannedStartAt)) / 60000);
      assert.equal(res.plannedDurationMinutes, sentDurationMin);
    });

    test('createEventEditionObject preserva data e hora de exibição no fuso da igreja em virada de meia-noite UTC', () => {
      const ev = createEventEditionObject({
        title: 'Vigília',
        plannedStartAt: '2026-11-15T23:00',
        plannedEndAt: '2026-11-16T01:00',
        durationPolicy: 'warn',
      }, { timezone: 'America/Sao_Paulo' }, ADMIN_CALLER);

      assert.equal(ev.plannedStartAt, '2026-11-16T02:00:00.000Z');
      assert.equal(ev.date, '2026-11-15');
      assert.equal(ev.scheduledStartTime, '23:00');
      assert.equal(ev.plannedDurationMinutes, 120);

      const formatted = formatInstantInTimeZone(ev.plannedStartAt, 'America/Sao_Paulo');
      assert.equal(formatted.date, '2026-11-15');
      assert.equal(formatted.time, '23:00');
    });

    test('validateEventEdition rejeita fuso horário inválido', () => {
      const res = validateEventEdition({
        title: 'Culto',
        plannedStartAt: '2026-11-15T19:00',
        plannedEndAt: '2026-11-15T20:30',
        durationPolicy: 'warn',
      }, { timezone: 'Invalid/Timezone_XYZ' }, ADMIN_CALLER);

      assert.equal(res.valid, false);
      assert.match(res.error, /Fuso horário da igreja não reconhecido/);
    });

    test('validateEventEdition rejeita data inexistente (ex.: 2026-02-31T10:00) em início ou término sem converter para 1970', () => {
      const invalidStart = validateEventEdition({
        title: 'Culto Data Inexistente',
        plannedStartAt: '2026-02-31T10:00',
        plannedEndAt: '2026-03-01T12:00',
        durationPolicy: 'warn',
      }, { timezone: 'America/Sao_Paulo' }, ADMIN_CALLER);

      assert.equal(invalidStart.valid, false);
      assert.match(invalidStart.error, /início inválida/i);

      const invalidEnd = validateEventEdition({
        title: 'Culto Término Inexistente',
        plannedStartAt: '2026-02-28T10:00',
        plannedEndAt: '2026-02-31T12:00',
        durationPolicy: 'warn',
      }, { timezone: 'America/Sao_Paulo' }, ADMIN_CALLER);

      assert.equal(invalidEnd.valid, false);
      assert.match(invalidEnd.error, /término inválida/i);
    });

    test('4.4 parseInstantInTimeZone, validateEventEdition e createChurchEventEditionRemote rejeitam hora inexistente em DST (America/New_York 2026-03-08T02:30) e data 2026-02-31 sem chamar RPC', async () => {
      assert.equal(parseInstantInTimeZone('2026-03-08T02:30', 'America/New_York'), null);

      const valRes = validateEventEdition({
        title: 'Culto DST Inexistente',
        plannedStartAt: '2026-03-08T02:30',
        plannedEndAt: '2026-03-08T04:00',
        durationPolicy: 'warn',
      }, { timezone: 'America/New_York' }, ADMIN_CALLER);
      assert.equal(valRes.valid, false);

      let called = false;
      const mockClient = {
        rpc: async () => {
          called = true;
          return { data: null, error: null };
        },
      };

      const dstRemote = await createChurchEventEditionRemote(mockClient, CHURCH_ID, {
        title: 'Culto DST Inexistente',
        eventType: 'Culto',
        timezone: 'America/New_York',
        plannedStartAt: '2026-03-08T02:30',
        plannedEndAt: '2026-03-08T04:00',
        durationPolicy: 'warn',
      });
      assert.equal(dstRemote.success, false);
      assert.equal(dstRemote.uncertain, false);
      assert.equal(called, false);

      const feb31Remote = await createChurchEventEditionRemote(mockClient, CHURCH_ID, {
        title: 'Culto 31 de Fevereiro',
        eventType: 'Culto',
        timezone: 'America/Sao_Paulo',
        plannedStartAt: '2026-02-31T10:00',
        plannedEndAt: '2026-02-31T12:00',
        durationPolicy: 'warn',
      });
      assert.equal(feb31Remote.success, false);
      assert.equal(feb31Remote.uncertain, false);
      assert.equal(called, false);
    });
  });

  describe('Tipo de evento obrigatório na criação remota', () => {
    test('createChurchEventEditionRemote envia o nome do tipo selecionado em p_event_type', async () => {
      const calls = [];
      const mockClient = {
        rpc: async (fn, params) => {
          calls.push({ fn, params });
          return canonicalCreateEventReceipt(params, 'ev-new-1');
        },
      };

      const res = await createChurchEventEditionRemote(mockClient, CHURCH_ID, {
        title: 'Culto de Jovens',
        eventType: 'Culto Jovem',
        plannedStartAt: '2026-11-15T22:00:00.000Z',
        plannedEndAt: '2026-11-15T23:30:00.000Z',
        durationPolicy: 'warn',
      });

      assert.equal(res.success, true);
      assert.equal(res.eventId, 'ev-new-1');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].fn, 'create_church_event_edition');
      assert.equal(calls[0].params.p_event_type, 'Culto Jovem');
    });

    test('createChurchEventEditionRemote rejeita criação quando eventType está ausente ou vazio', async () => {
      let called = false;
      const mockClient = {
        rpc: async () => {
          called = true;
          return { data: null, error: null };
        },
      };

      const res = await createChurchEventEditionRemote(mockClient, CHURCH_ID, {
        title: 'Culto Sem Tipo',
        eventType: '   ',
        plannedStartAt: '2026-11-15T22:00:00.000Z',
        plannedEndAt: '2026-11-15T23:30:00.000Z',
        durationPolicy: 'warn',
      });

      assert.equal(res.success, false);
      assert.equal(called, false);
      assert.match(res.error, /Tipo de evento não informado/);
    });
  });

  describe('Horário efetivamente enviado em createChurchEventEditionRemote', () => {
    function createCapturingClient(calls) {
      return {
        rpc: async (fn, params) => {
          calls.push({ fn, params });
          return canonicalCreateEventReceipt(params, 'ev-new-tz');
        },
      };
    }

    test('1) envia hora local sem fuso em America/Sao_Paulo como instante equivalente com deslocamento explícito', async () => {
      const calls = [];
      const res = await createChurchEventEditionRemote(createCapturingClient(calls), CHURCH_ID, {
        title: 'Culto Domingo Noite',
        eventType: 'Culto',
        timezone: 'America/Sao_Paulo',
        plannedStartAt: '2026-11-01T19:00',
        plannedEndAt: '2026-11-01T20:45',
        durationPolicy: 'warn',
      });

      assert.equal(res.success, true);
      const { p_planned_start_at, p_planned_end_at } = calls[0].params;
      assert.match(p_planned_start_at, /[+-]\d{2}:\d{2}$/);
      assert.match(p_planned_end_at, /[+-]\d{2}:\d{2}$/);
      assert.equal(Date.parse(p_planned_start_at), Date.parse('2026-11-01T19:00:00-03:00'));
      assert.equal(Date.parse(p_planned_end_at), Date.parse('2026-11-01T20:45:00-03:00'));
      assert.equal(Date.parse(p_planned_end_at) - Date.parse(p_planned_start_at), 105 * 60000);
    });

    test('2) envia hora local em fuso diferente do processo (America/Manaus) sem interferência do fuso do processo', async () => {
      const calls = [];
      const res = await createChurchEventEditionRemote(createCapturingClient(calls), CHURCH_ID, {
        title: 'Culto Manaus',
        eventType: 'Culto',
        timezone: 'America/Manaus',
        plannedStartAt: '2026-11-01T19:00',
        plannedEndAt: '2026-11-01T20:45',
        durationPolicy: 'warn',
      });

      assert.equal(res.success, true);
      const { p_planned_start_at, p_planned_end_at } = calls[0].params;
      assert.equal(Date.parse(p_planned_start_at), Date.parse('2026-11-01T19:00:00-04:00'));
      assert.equal(Date.parse(p_planned_end_at), Date.parse('2026-11-01T20:45:00-04:00'));
      assert.equal(Date.parse(p_planned_end_at) - Date.parse(p_planned_start_at), 105 * 60000);
    });

    test('3) forma legada event_date + start_time + planned_duration_minutes envia duração exatamente igual à planejada', async () => {
      const calls = [];
      const res = await createChurchEventEditionRemote(createCapturingClient(calls), CHURCH_ID, {
        title: 'Culto Legado Duração',
        event_type: 'Culto',
        timezone: 'America/Sao_Paulo',
        event_date: '2026-11-01',
        start_time: '19:00',
        planned_duration_minutes: 90,
        duration_policy: 'warn',
      });

      assert.equal(res.success, true);
      const { p_planned_start_at, p_planned_end_at } = calls[0].params;
      assert.equal(Date.parse(p_planned_start_at), Date.parse('2026-11-01T19:00:00-03:00'));
      assert.equal(Date.parse(p_planned_end_at) - Date.parse(p_planned_start_at), 90 * 60000);
    });

    test('4) forma legada com target_end_time não posterior ao início avança para o dia seguinte no fuso da igreja', async () => {
      const calls = [];
      const res = await createChurchEventEditionRemote(createCapturingClient(calls), CHURCH_ID, {
        title: 'Vigília Legada',
        event_type: 'Vigília',
        timezone: 'America/Manaus',
        event_date: '2026-11-15',
        start_time: '23:00',
        target_end_time: '01:00',
        duration_policy: 'warn',
      });

      assert.equal(res.success, true);
      const { p_planned_start_at, p_planned_end_at } = calls[0].params;
      assert.equal(Date.parse(p_planned_start_at), Date.parse('2026-11-15T23:00:00-04:00'));
      assert.equal(Date.parse(p_planned_end_at), Date.parse('2026-11-16T01:00:00-04:00'));
      assert.equal(Date.parse(p_planned_end_at) - Date.parse(p_planned_start_at), 120 * 60000);
    });

    test('5) quando timezone está ausente, usa America/Sao_Paulo por padrão', async () => {
      const calls = [];
      const res = await createChurchEventEditionRemote(createCapturingClient(calls), CHURCH_ID, {
        title: 'Culto Sem Fuso Explícito',
        eventType: 'Culto',
        plannedStartAt: '2026-11-01T19:00',
        plannedEndAt: '2026-11-01T20:30',
        durationPolicy: 'warn',
      });

      assert.equal(res.success, true);
      const { p_planned_start_at, p_planned_end_at } = calls[0].params;
      assert.equal(Date.parse(p_planned_start_at), Date.parse('2026-11-01T19:00:00-03:00'));
      assert.equal(Date.parse(p_planned_end_at), Date.parse('2026-11-01T20:30:00-03:00'));
    });
  });

  describe('4.1 Recibo estrito na criação da edição (testes negativos)', () => {
    const basePayload = {
      title: 'Culto Recibo Estrito',
      eventType: 'Culto',
      plannedStartAt: '2026-11-01T19:00',
      plannedEndAt: '2026-11-01T20:30',
      durationPolicy: 'warn',
    };

    const invalidCases = [
      ['null', () => null],
      ['array vazio []', () => []],
      ['duas linhas', (p) => [
        { command_id: p.p_command_id, action: 'create_church_event_edition', church_id: p.p_church_id, result_entity_id: 'ev-1', result_payload: { event_id: 'ev-1' }, created_at: '2026-11-01T00:00:00Z' },
        { command_id: p.p_command_id, action: 'create_church_event_edition', church_id: p.p_church_id, result_entity_id: 'ev-2', result_payload: { event_id: 'ev-2' }, created_at: '2026-11-01T00:00:00Z' },
      ]],
      ['command_id divergente', (p) => [{ command_id: 'cmd-outro', action: 'create_church_event_edition', church_id: p.p_church_id, result_entity_id: 'ev-1', result_payload: { event_id: 'ev-1' }, created_at: '2026-11-01T00:00:00Z' }]],
      ['action divergente', (p) => [{ command_id: p.p_command_id, action: 'outra_acao', church_id: p.p_church_id, result_entity_id: 'ev-1', result_payload: { event_id: 'ev-1' }, created_at: '2026-11-01T00:00:00Z' }]],
      ['church_id divergente', (p) => [{ command_id: p.p_command_id, action: 'create_church_event_edition', church_id: 'church-outra', result_entity_id: 'ev-1', result_payload: { event_id: 'ev-1' }, created_at: '2026-11-01T00:00:00Z' }]],
      ['result_entity_id ausente', (p) => [{ command_id: p.p_command_id, action: 'create_church_event_edition', church_id: p.p_church_id, result_entity_id: null, result_payload: { event_id: 'ev-1' }, created_at: '2026-11-01T00:00:00Z' }]],
      ['payload somente com id sem event_id', (p) => [{ command_id: p.p_command_id, action: 'create_church_event_edition', church_id: p.p_church_id, result_entity_id: 'ev-1', result_payload: { id: 'ev-1' }, created_at: '2026-11-01T00:00:00Z' }]],
      ['result_payload.event_id divergente', (p) => [{ command_id: p.p_command_id, action: 'create_church_event_edition', church_id: p.p_church_id, result_entity_id: 'ev-1', result_payload: { event_id: 'ev-2' }, created_at: '2026-11-01T00:00:00Z' }]],
      ['created_at ausente', (p) => [{ command_id: p.p_command_id, action: 'create_church_event_edition', church_id: p.p_church_id, result_entity_id: 'ev-1', result_payload: { event_id: 'ev-1' } }]],
      ['created_at não interpretável', (p) => [{ command_id: p.p_command_id, action: 'create_church_event_edition', church_id: p.p_church_id, result_entity_id: 'ev-1', result_payload: { event_id: 'ev-1' }, created_at: 'data-invalida' }]],
    ];

    for (const [label, makeData] of invalidCases) {
      test(`rejeita recibo inválido (${label}) sem sucesso e sem ID sintético`, async () => {
        const mockClient = {
          rpc: async (_fn, params) => ({ data: makeData(params), error: null }),
        };
        const res = await createChurchEventEditionRemote(mockClient, CHURCH_ID, basePayload);
        assert.equal(res.success, false);
        assert.equal(res.uncertain, true);
        assert.equal(res.eventId, undefined);
      });
    }

    test('event_id correto acompanhado de id conflitante preserva result_entity_id sem sobrescrita', async () => {
      const mockClient = {
        rpc: async (_fn, params) => ({
          data: [{
            command_id: params.p_command_id,
            action: 'create_church_event_edition',
            church_id: params.p_church_id,
            result_entity_id: 'ev-canonico',
            result_payload: { event_id: 'ev-canonico', id: 'id-conflitante', status: 'scheduled' },
            created_at: '2026-11-01T00:00:00Z',
          }],
          error: null,
        }),
      };
      const res = await createChurchEventEditionRemote(mockClient, CHURCH_ID, basePayload);
      assert.equal(res.success, true);
      assert.equal(res.eventId, 'ev-canonico');
      assert.equal(res.data.id, 'ev-canonico');
    });

    test('no AppContext, recibo inválido não altera a lista de eventos', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }
      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'create_church_event_edition') return { data: [{ id: 'sintetico' }], error: null };
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

      const beforeCount = appCtx.events.length;
      let createRes;
      await act(async () => {
        createRes = await appCtx.createEventEdition({
          title: 'Culto Sem Recibo',
          type: 'Culto',
          plannedStartAt: '2026-11-01T19:00',
          plannedEndAt: '2026-11-01T20:30',
        });
      });

      assert.equal(createRes.success, false);
      assert.equal(appCtx.events.length, beforeCount);
    });
  });

  describe('4.1 / 4.2 / 4.3 Tentativa incerta de criação, pendência explícita, retry na tela e limpeza segura (AppContext + PlanningView)', () => {
    const payloadA = {
      title: 'Culto A',
      type: 'Culto',
      plannedStartAt: '2026-11-01T19:00',
      plannedEndAt: '2026-11-01T20:30',
    };

    test('falha incerta preserva pendingCreateEvent mesmo após reloadRemoteData; dados alterados não chamam RPC; retryPendingCreateEvent reutiliza command_id e limpa ao concluir', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const createCommands = [];
      let attempt = 0;
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') {
            return { data: [{ events: [], total_count: 0 }], error: null };
          }
          if (fn === 'list_event_types') {
            return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          }
          if (fn === 'create_church_event_edition') {
            attempt += 1;
            createCommands.push(params.p_command_id);
            if (attempt === 1) {
              return { data: null, error: null };
            }
            return canonicalCreateEventReceipt(params, 'ev-recovered-1');
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

      // 1) Primeira tentativa com resposta perdida
      let r1;
      await act(async () => {
        r1 = await appCtx.createEventEdition(payloadA);
      });
      assert.equal(r1.success, false);
      assert.equal(r1.uncertain, true);
      assert.equal(createCommands.length, 1);
      assert.ok(appCtx.pendingCreateEvent);
      assert.equal(appCtx.pendingCreateEvent.commandId, createCommands[0]);
      assert.equal(appCtx.pendingCreateEvent.summary.title, 'Culto A');

      // 2) reloadRemoteData não limpa a pendência
      await act(async () => {
        await appCtx.reloadRemoteData();
      });
      assert.ok(appCtx.pendingCreateEvent);
      assert.equal(appCtx.pendingCreateEvent.commandId, createCommands[0]);

      // 3) Tentativa com dados ALTERADOS é bloqueada sem chamar RPC e sem limpar pendência, devolvendo pendingSummary original
      let rChanged;
      await act(async () => {
        rChanged = await appCtx.createEventEdition({
          ...payloadA,
          title: 'Culto B Alterado',
          plannedStartAt: '2026-11-02T20:00',
          plannedEndAt: '2026-11-02T21:30',
        });
      });
      assert.equal(rChanged.success, false);
      assert.equal(rChanged.uncertain, true);
      assert.ok(rChanged.pendingSummary);
      assert.equal(rChanged.pendingSummary.title, 'Culto A');
      assert.equal(rChanged.pendingSummary.type, 'Culto');
      assert.equal(rChanged.pendingSummary.plannedStartAt, '2026-11-01T22:00:00.000Z');
      assert.equal(rChanged.pendingSummary.plannedEndAt, '2026-11-01T23:30:00.000Z');
      assert.equal(createCommands.length, 1);
      assert.ok(appCtx.pendingCreateEvent);
      assert.equal(appCtx.pendingCreateEvent.summary.title, 'Culto A');

      // 4) retryPendingCreateEvent reutiliza exatamente o mesmo command_id e limpa ao concluir
      let rRetry;
      await act(async () => {
        rRetry = await appCtx.retryPendingCreateEvent();
      });
      assert.equal(rRetry.success, true);
      assert.equal(createCommands.length, 2);
      assert.equal(createCommands[0], createCommands[1]);
      assert.equal(appCtx.pendingCreateEvent, null);
    });

    test('C2 cenário paginado (50 eventos, total_count > 50, edição ausente da 1ª página): tentativa alterada não lista nem cria, devolve resumo original e retryPendingCreateEvent repete parâmetros idênticos', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const firstPageEvents = Array.from({ length: 50 }, (_, idx) => ({
        id: `ev-page1-${idx + 1}`,
        church_id: CHURCH_ID,
        title: `Culto Página 1 #${idx + 1}`,
        event_type: 'Culto',
        planned_start_at: '2026-12-01T22:00:00.000Z',
        planned_end_at: '2026-12-01T23:30:00.000Z',
        timezone: 'America/Sao_Paulo',
      }));

      let listCalls = 0;
      const createCalls = [];
      let createAttempt = 0;

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') {
            listCalls += 1;
            return { data: [{ events: firstPageEvents, total_count: 75 }], error: null };
          }
          if (fn === 'list_event_types') {
            return {
              data: [
                { id: 't1', name: 'Culto', active: true },
                { id: 't2', name: 'Vigília', active: true },
              ],
              error: null,
            };
          }
          if (fn === 'create_church_event_edition') {
            createAttempt += 1;
            createCalls.push({ ...params });
            if (createAttempt === 1) {
              return { data: null, error: null };
            }
            return canonicalCreateEventReceipt(params, 'ev-paginated-recovered');
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

      assert.equal(appCtx.events.length, 50);
      assert.equal(listCalls, 1);

      const originalPayload = {
        title: 'Culto Original Fora da Página 1',
        type: 'Culto',
        plannedStartAt: '2026-11-01T19:00',
        plannedEndAt: '2026-11-01T20:30',
      };

      let rInitial;
      await act(async () => {
        rInitial = await appCtx.createEventEdition(originalPayload);
      });
      assert.equal(rInitial.success, false);
      assert.equal(rInitial.uncertain, true);
      assert.equal(createCalls.length, 1);
      assert.ok(appCtx.pendingCreateEvent);
      assert.equal(appCtx.events.some(ev => ev.title === originalPayload.title), false);

      // Contagem exata antes da tentativa alterada
      const listCallsBeforeAltered = listCalls;
      const createCallsBeforeAltered = createCalls.length;
      const originalPendingSnapshot = { ...appCtx.pendingCreateEvent };

      let rAltered;
      await act(async () => {
        rAltered = await appCtx.createEventEdition({
          title: 'Culto Alterado',
          type: 'Vigília',
          plannedStartAt: '2026-11-05T22:00',
          plannedEndAt: '2026-11-06T01:00',
        });
      });

      assert.equal(rAltered.success, false);
      assert.equal(rAltered.uncertain, true);
      assert.equal(listCalls, listCallsBeforeAltered);
      assert.equal(createCalls.length, createCallsBeforeAltered);
      assert.ok(rAltered.pendingSummary);
      assert.equal(rAltered.pendingSummary.title, originalPayload.title);
      assert.equal(rAltered.pendingSummary.type, 'Culto');
      assert.equal(rAltered.pendingSummary.plannedStartAt, '2026-11-01T22:00:00.000Z');
      assert.equal(rAltered.pendingSummary.plannedEndAt, '2026-11-01T23:30:00.000Z');
      assert.deepEqual(appCtx.pendingCreateEvent, originalPendingSnapshot);

      // Repetição via retryPendingCreateEvent reenvia exatamente os mesmos parâmetros da tentativa original
      let rRetry;
      await act(async () => {
        rRetry = await appCtx.retryPendingCreateEvent();
      });
      assert.equal(rRetry.success, true);
      assert.equal(createCalls.length, 2);
      assert.equal(createCalls[1].p_command_id, createCalls[0].p_command_id);
      assert.deepEqual(createCalls[1], createCalls[0]);
      assert.equal(appCtx.pendingCreateEvent, null);
    });

    test('erro definitivo (uncertain: false) limpa pendingCreateEvent; troca de igreja também limpa pendência', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const createCommands = [];
      let failMode = 'definitive';
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'create_church_event_edition') {
            createCommands.push(params.p_command_id);
            if (failMode === 'definitive') {
              return { data: null, error: { code: '23514', message: 'Regra de negócio violada' } };
            }
            if (failMode === 'uncertain') {
              return { data: null, error: null };
            }
            return canonicalCreateEventReceipt(params, 'ev-after-def');
          }
          return { data: [], error: null };
        },
      };

      let renderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: CHURCH_ID, supabaseClient: mockClient },
            React.createElement(Consumer)
          )
        );
      });

      // Erro definitivo limpa pendência imediatamente
      let rDef;
      await act(async () => {
        rDef = await appCtx.createEventEdition(payloadA);
      });
      assert.equal(rDef.success, false);
      assert.equal(rDef.uncertain, false);
      assert.equal(appCtx.pendingCreateEvent, null);

      // Agora falha incerta cria pendência, e troca de igreja limpa
      failMode = 'uncertain';
      let rUnc;
      await act(async () => {
        rUnc = await appCtx.createEventEdition({ ...payloadA, title: 'Culto Pendencia Igreja' });
      });
      assert.equal(rUnc.success, false);
      assert.equal(rUnc.uncertain, true);
      assert.ok(appCtx.pendingCreateEvent);

      await act(async () => {
        renderer.update(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: 'church-other-2', supabaseClient: mockClient },
            React.createElement(Consumer)
          )
        );
      });
      assert.equal(appCtx.pendingCreateEvent, null);
    });

    test('PlanningView exibe #banner-pending-create-event após falha incerta, bloqueia novo envio e conclui via #btn-retry-pending-create-event com mesmo p_command_id', async () => {
      const createCommands = [];
      let attempt = 0;
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'create_church_event_edition') {
            attempt += 1;
            createCommands.push(params.p_command_id);
            if (attempt === 1) return { data: null, error: null };
            return canonicalCreateEventReceipt(params, 'ev-ui-retry-1');
          }
          return { data: [], error: null };
        },
      };

      let tree;
      await act(async () => {
        tree = TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: CHURCH_ID, supabaseClient: mockClient },
            React.createElement(PlanningView)
          )
        );
      });

      await act(async () => {
        tree.root.find(n => n.type === 'button' && n.props?.id === 'btn-open-create-event-modal').props.onClick();
      });
      await act(async () => {
        tree.root.find(n => n.type === 'input' && n.props?.id === 'event-title').props.onChange({ target: { value: 'Culto UI Retry' } });
      });

      // 1) Envio inicial com resposta perdida
      const form = tree.root.find(n => n.type === 'form');
      await act(async () => {
        await form.props.onSubmit({ preventDefault: () => {} });
      });

      const banner = tree.root.find(n => n.props?.id === 'banner-pending-create-event');
      const bannerText = extractNodeText(banner);
      assert.match(bannerText, /Culto UI Retry/);
      assert.match(bannerText, /Não é possível saber se a tentativa anterior foi gravada/i);

      const submitBtn = tree.root.find(n => n.type === 'button' && n.props?.id === 'btn-submit-create-event');
      assert.equal(submitBtn.props.disabled, true);

      const retryBtn = tree.root.find(n => n.type === 'button' && n.props?.id === 'btn-retry-pending-create-event');
      await act(async () => {
        await retryBtn.props.onClick();
      });

      assert.equal(createCommands.length, 2);
      assert.equal(createCommands[0], createCommands[1]);
      assert.equal(tree.root.findAll(n => n.props?.id === 'banner-pending-create-event').length, 0);
    });

    test('PlanningView não exibe #banner-pending-create-event após erro definitivo (uncertain: false)', async () => {
      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'create_church_event_edition') {
            return { data: null, error: { code: '23514', message: 'Erro definitivo de validação' } };
          }
          return { data: [], error: null };
        },
      };

      let tree;
      await act(async () => {
        tree = TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: CHURCH_ID, supabaseClient: mockClient },
            React.createElement(PlanningView)
          )
        );
      });

      await act(async () => {
        tree.root.find(n => n.type === 'button' && n.props?.id === 'btn-open-create-event-modal').props.onClick();
      });
      await act(async () => {
        tree.root.find(n => n.type === 'input' && n.props?.id === 'event-title').props.onChange({ target: { value: 'Culto Erro Def' } });
      });
      await act(async () => {
        await tree.root.find(n => n.type === 'form').props.onSubmit({ preventDefault: () => {} });
      });

      assert.equal(tree.root.findAll(n => n.props?.id === 'banner-pending-create-event').length, 0);
    });
  });

  describe('4.4 / 4.5 / 4.6 teamsLoadStatus, lista vazia limpa events e payload sanitizado', () => {
    test('4.4 não-admin com falha de list_church_teams recebe unavailable: true, não vê texto de não autorizado e desbloqueia após recarregar', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let teamsFail = true;
      let createCalls = 0;
      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'list_church_teams') {
            if (teamsFail) return { data: null, error: { message: 'Falha ao carregar equipes' } };
            return { data: [{ id: 't-louvor', name: 'Louvor', leader_member_id: 'mariana' }], error: null };
          }
          if (fn === 'create_church_event_edition') {
            createCalls += 1;
            return { data: null, error: null };
          }
          return { data: [], error: null };
        },
      };

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
      assert.match(extractNodeText(notice), /Não foi possível carregar as equipes/i);
      const textAll = JSON.stringify(tree.toJSON());
      assert.equal(/serão habilitadas assim que a liderança/i.test(textAll), false);
      assert.equal(tree.root.find(n => n.type === 'button' && n.props?.id === 'btn-open-create-event-modal').props.disabled, true);

      let resFail;
      await act(async () => {
        resFail = await appCtx.createEventEdition({
          title: 'Culto Sem Equipes',
          type: 'Culto',
          plannedStartAt: '2026-11-01T19:00',
          plannedEndAt: '2026-11-01T20:30',
        });
      });
      assert.equal(resFail.success, false);
      assert.equal(resFail.unavailable, true);
      assert.equal(createCalls, 0);

      // Recarrega equipes com sucesso
      teamsFail = false;
      await act(async () => {
        await tree.root.find(n => n.type === 'button' && n.props?.id === 'btn-reload-teams-status').props.onClick();
      });
      assert.equal(appCtx.teamsLoadStatus, 'loaded');
      assert.equal(tree.root.findAll(n => n.props?.id === 'notice-teams-load-status').length, 0);
      assert.equal(tree.root.find(n => n.type === 'button' && n.props?.id === 'btn-open-create-event-modal').props.disabled, false);
    });

    test('4.4 admin ignora teamsLoadStatus === failed e mantém criação habilitada', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'list_church_teams') return { data: null, error: { message: 'Falha ao carregar equipes' } };
          if (fn === 'create_church_event_edition') return canonicalCreateEventReceipt(params, 'ev-admin-ok');
          return { data: [], error: null };
        },
      };

      let tree;
      await act(async () => {
        tree = TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: CHURCH_ID, supabaseClient: mockClient },
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        );
      });

      assert.equal(appCtx.teamsLoadStatus, 'failed');
      assert.equal(tree.root.findAll(n => n.props?.id === 'notice-teams-load-status').length, 0);
      assert.equal(tree.root.find(n => n.type === 'button' && n.props?.id === 'btn-open-create-event-modal').props.disabled, false);

      let resAdmin;
      await act(async () => {
        resAdmin = await appCtx.createEventEdition({
          title: 'Culto Admin Mesmo Sem Equipes',
          type: 'Culto',
          plannedStartAt: '2026-11-01T19:00',
          plannedEndAt: '2026-11-01T20:30',
        });
      });
      assert.equal(resAdmin.success, true);
    });

    test('4.5 list_church_events válida e vazia limpa events e currentEventId; falha preserva estado atual', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let eventsMode = 'one';
      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'list_church_events') {
            if (eventsMode === 'one') {
              return {
                data: [{
                  events: [{
                    id: 'ev-srv-1',
                    church_id: CHURCH_ID,
                    title: 'Culto Existente',
                    event_type: 'Culto',
                    planned_start_at: '2026-11-01T22:00:00.000Z',
                    planned_end_at: '2026-11-01T23:30:00.000Z',
                    timezone: 'America/Sao_Paulo',
                  }],
                  total_count: 1,
                }],
                error: null,
              };
            }
            if (eventsMode === 'error') {
              return { data: null, error: { message: 'Falha transitória' } };
            }
            return { data: [{ events: [], total_count: 0 }], error: null };
          }
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
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

      assert.equal(appCtx.events.length, 1);
      assert.equal(appCtx.currentEventId, 'ev-srv-1');

      // Erro preserva estado
      eventsMode = 'error';
      await act(async () => {
        await appCtx.reloadRemoteData();
      });
      assert.equal(appCtx.events.length, 1);
      assert.equal(appCtx.currentEventId, 'ev-srv-1');

      // Lista válida e vazia limpa events e currentEventId
      eventsMode = 'empty';
      await act(async () => {
        await appCtx.reloadRemoteData();
      });
      assert.equal(appCtx.events.length, 0);
      assert.equal(appCtx.currentEventId, null);
    });

    test('4.6 createChurchEventEditionRemote sanitiza id conflitante em res.payload preservando eventId e data.id', async () => {
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'create_church_event_edition') {
            return {
              data: [{
                id: 'receipt-san-1',
                command_id: params.p_command_id,
                action: 'create_church_event_edition',
                church_id: params.p_church_id,
                result_entity_id: 'ev-real-id',
                result_payload: {
                  id: 'payload-wrong-id',
                  event_id: 'ev-real-id',
                  title: params.p_title,
                },
                created_at: '2026-11-01T00:00:00Z',
              }],
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };

      const res = await createChurchEventEditionRemote(mockClient, CHURCH_ID, {
        title: 'Culto Sanitizado',
        eventType: 'Culto',
        plannedStartAt: '2026-11-01T19:00',
        plannedEndAt: '2026-11-01T20:30',
        timezone: 'America/Sao_Paulo',
      });

      assert.equal(res.success, true);
      assert.equal(res.eventId, 'ev-real-id');
      assert.equal(res.data.id, 'ev-real-id');
      assert.equal(res.payload.id, undefined);
      assert.equal(res.payload.event_id, 'ev-real-id');
    });
  });

  describe('4.6 Opção B na tela e no contexto + 4.7 Catálogo de tipos vazio', () => {
    function makeRemoteClient({ eventTypes = [{ id: 't1', name: 'Culto', active: true }], rpcCalls = [] } = {}) {
      return {
        rpc: async (fn, params) => {
          rpcCalls.push({ fn, params });
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: eventTypes, error: null };
          if (fn === 'list_church_teams') return { data: [{ id: 't-louvor', name: 'Louvor', leader_member_id: 'mariana' }], error: null };
          if (fn === 'create_church_event_edition') return canonicalCreateEventReceipt(params, 'ev-opt-b');
          return { data: [], error: null };
        },
      };
    }

    test('4.6 líder de equipe vê botão de criar edição, envia p_liturgy_leader_member_id nulo e não chama create_event_item; membro comum não possui criação habilitada', async () => {
      // Membro comum ('beatriz'): não possui ação habilitada de criação de edição
      let memberTree;
      await act(async () => {
        memberTree = TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'beatriz', churchId: CHURCH_ID, supabaseClient: makeRemoteClient() },
            React.createElement(PlanningView)
          )
        );
      });
      const memberCreateBtns = memberTree.root.findAll(n => n.type === 'button' && n.props?.id === 'btn-open-create-event-modal');
      assert.ok(memberCreateBtns.length === 0 || memberCreateBtns.every(b => b.props.disabled === true));

      // Líder de equipe ('mariana'): vê botão de criação e campo dirigente travado em vazio
      let leaderApp = null;
      const rpcCalls = [];
      function LeaderHarness() {
        leaderApp = useApp();
        return React.createElement(PlanningView);
      }

      let leaderTree;
      await act(async () => {
        leaderTree = TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'mariana', churchId: CHURCH_ID, supabaseClient: makeRemoteClient({ rpcCalls }) },
            React.createElement(LeaderHarness)
          )
        );
      });

      const openBtn = leaderTree.root.find(n => n.type === 'button' && n.props?.id === 'btn-open-create-event-modal');
      assert.ok(openBtn);

      await act(async () => {
        openBtn.props.onClick();
      });

      const leaderSelect = leaderTree.root.find(n => n.type === 'select' && n.props?.id === 'event-liturgy-leader');
      assert.equal(leaderSelect.props.value, '');
      assert.equal(leaderSelect.props.disabled, true);

      // Criação via contexto pelo líder de equipe com etapas iniciais: dirigente nulo e 0 chamadas a create_event_item
      let res;
      await act(async () => {
        res = await leaderApp.createEventEdition({
          title: 'Culto Criado por Líder',
          type: 'Culto',
          plannedStartAt: '2026-11-01T19:00',
          plannedEndAt: '2026-11-01T20:30',
          liturgyLeaderId: null,
          activities: [{ title: 'Abertura', plannedDurationMinutes: 10 }],
        });
      });

      assert.equal(res.success, true);
      const createCall = rpcCalls.find(c => c.fn === 'create_church_event_edition');
      assert.ok(createCall);
      assert.equal(createCall.params.p_liturgy_leader_member_id, null);
      assert.equal(rpcCalls.filter(c => c.fn === 'create_event_item').length, 0);
      assert.match(res.warning, /dirigente/i);
    });

    test('4.3 e 4.4 contexto recusa dirigente preenchido por líder de equipe, e bloqueia criação por dirigente/membro no ambiente conectado', async () => {
      // Líder de equipe ('mariana') passando dirigente preenchido: recusado antes de qualquer RPC
      const leaderCalls = [];
      let leaderApp = null;
      function LeaderHarness() {
        leaderApp = useApp();
        return null;
      }
      await act(async () => {
        TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'mariana', churchId: CHURCH_ID, supabaseClient: makeRemoteClient({ rpcCalls: leaderCalls }) },
            React.createElement(LeaderHarness)
          )
        );
      });

      let leaderErrRes;
      await act(async () => {
        leaderErrRes = await leaderApp.createEventEdition({
          title: 'Culto Com Dirigente Indevido',
          type: 'Culto',
          plannedStartAt: '2026-11-01T19:00',
          plannedEndAt: '2026-11-01T20:30',
          liturgyLeaderId: 'marcos',
        });
      });
      assert.equal(leaderErrRes.success, false);
      assert.match(leaderErrRes.error, /Somente o administrador pode designar/i);
      assert.equal(leaderCalls.filter(c => c.fn === 'create_church_event_edition').length, 0);

      // Dirigente não-admin e não-líder de equipe ('carlos'): botão desabilitado/ausente e contexto recusa sem RPC
      const dirCalls = [];
      let dirApp = null;
      function DirHarness() {
        dirApp = useApp();
        return React.createElement(PlanningView);
      }
      let dirTree;
      await act(async () => {
        dirTree = TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'carlos', churchId: CHURCH_ID, supabaseClient: makeRemoteClient({ rpcCalls: dirCalls }) },
            React.createElement(DirHarness)
          )
        );
      });
      const dirCreateBtns = dirTree.root.findAll(n => n.type === 'button' && n.props?.id === 'btn-open-create-event-modal');
      assert.ok(dirCreateBtns.length === 0 || dirCreateBtns.every(b => b.props.disabled === true));

      let dirRes;
      await act(async () => {
        dirRes = await dirApp.createEventEdition({
          title: 'Culto por Dirigente',
          type: 'Culto',
          plannedStartAt: '2026-11-01T19:00',
          plannedEndAt: '2026-11-01T20:30',
          liturgyLeaderId: null,
        });
      });
      assert.equal(dirRes.success, false);
      assert.match(dirRes.error, /administradores ou líderes de equipe/i);
      assert.equal(dirCalls.filter(c => c.fn === 'create_church_event_edition').length, 0);

      // Administrador ('marcos') continua criando normalmente
      const adminCalls = [];
      let adminApp = null;
      function AdminHarness() {
        adminApp = useApp();
        return null;
      }
      await act(async () => {
        TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: CHURCH_ID, supabaseClient: makeRemoteClient({ rpcCalls: adminCalls }) },
            React.createElement(AdminHarness)
          )
        );
      });
      let adminRes;
      await act(async () => {
        adminRes = await adminApp.createEventEdition({
          title: 'Culto por Admin',
          type: 'Culto',
          plannedStartAt: '2026-11-01T19:00',
          plannedEndAt: '2026-11-01T20:30',
          liturgyLeaderId: 'carlos',
        });
      });
      assert.equal(adminRes.success, true);
      assert.equal(adminCalls.filter(c => c.fn === 'create_church_event_edition').length, 1);
    });

    test('4.7 catálogo de tipos vazio em ambiente conectado bloqueia criação e não oferece Celebração Geral', async () => {
      const rpcCalls = [];
      let adminTree;
      await act(async () => {
        adminTree = TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: CHURCH_ID, supabaseClient: makeRemoteClient({ eventTypes: [], rpcCalls }) },
            React.createElement(PlanningView)
          )
        );
      });

      const openBtn = adminTree.root.find(n => n.type === 'button' && n.props?.id === 'btn-open-create-event-modal');
      await act(async () => {
        openBtn.props.onClick();
      });

      const typeSelect = adminTree.root.find(n => n.type === 'select' && n.props?.id === 'event-type');
      const optionTexts = typeSelect.findAll(n => n.type === 'option').map(o => o.props.value);
      assert.equal(optionTexts.includes('Celebração Geral'), false);

      const emptyNotice = adminTree.root.findAll(n => n.props?.id === 'event-type-empty-notice');
      assert.equal(emptyNotice.length, 1);

      const submitBtn = adminTree.root.find(n => n.type === 'button' && n.props?.id === 'btn-submit-create-event');
      assert.equal(submitBtn.props.disabled, true);
      assert.equal(rpcCalls.filter(c => c.fn === 'create_church_event_edition').length, 0);
    });
  });

  describe('4.8 Restrição de controles que não são de criação para líder de equipe (Rodada 4)', () => {
    function findEditActivityButtons(root) {
      return root.findAll(n => {
        if (n.type !== 'button') return false;
        const text = n.children.filter(c => typeof c === 'string').join('').trim();
        return text === 'Editar';
      });
    }

    test('líder de equipe não-admin e não-dirigente só tem criação habilitada; os 10 controles de edição/publicação ficam desabilitados', async () => {
      let leaderTree;
      await act(async () => {
        leaderTree = TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'mariana' },
            React.createElement(PlanningView)
          )
        );
      });

      const root = leaderTree.root;
      const createBtn = root.find(n => n.type === 'button' && n.props?.id === 'btn-open-create-event-modal');
      assert.equal(createBtn.props.disabled, false);

      // 6 controles restaurados na rodada 4
      assert.equal(root.find(n => n.type === 'select' && n.props?.id === 'select-duration-policy').props.disabled, true);
      assert.equal(root.find(n => n.type === 'button' && n.props?.id === 'btn-save-program-draft').props.disabled, true);
      assert.equal(root.find(n => n.type === 'button' && n.props?.id === 'btn-publish-program').props.disabled, true);
      assert.equal(root.find(n => n.type === 'select' && n.props?.id === 'select-service-template').props.disabled, true);

      const editBtns = findEditActivityButtons(root);
      assert.ok(editBtns.length >= 1);
      assert.ok(editBtns.every(b => b.props.disabled === true));

      const removeParallelBtns = root.findAll(
        n => n.type === 'button' && typeof n.props?.id === 'string' && n.props.id.startsWith('btn-remove-parallel-service-')
      );
      assert.ok(removeParallelBtns.length >= 1);
      assert.ok(removeParallelBtns.every(b => b.props.disabled === true));

      // 4 controles que já estavam corretos
      assert.equal(root.find(n => n.type === 'button' && n.props?.id === 'btn-apply-service-template').props.disabled, true);
      assert.equal(root.find(n => n.type === 'button' && n.props?.id === 'btn-open-new-activity-modal').props.disabled, true);

      const moveUpBtns = root.findAll(
        n => n.type === 'button' && typeof n.props?.id === 'string' && n.props.id.startsWith('btn-move-up-')
      );
      const moveDownBtns = root.findAll(
        n => n.type === 'button' && typeof n.props?.id === 'string' && n.props.id.startsWith('btn-move-down-')
      );
      assert.ok(moveUpBtns.length >= 2);
      assert.ok(moveDownBtns.length >= 2);
      assert.ok(moveUpBtns.every(b => b.props.disabled === true));
      assert.ok(moveDownBtns.every(b => b.props.disabled === true));
    });

    test('contraponto: dirigente do evento selecionado (não-admin e não-líder de equipe) tem criação desabilitada e todos os 10 controles de edição habilitados', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      const tpl = {
        id: 'tpl-counter-1',
        name: 'Modelo Contraponto',
        active: true,
        activities: [{ id: 'ta-1', title: 'Abertura', category: 'Liturgia', plannedDurationMinutes: 10, displayOrder: 1 }],
        parallelServices: [],
      };
      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_church_events') return { data: [{ events: [], total_count: 0 }], error: null };
          if (fn === 'list_event_types') return { data: [{ id: 't1', name: 'Culto', active: true }], error: null };
          if (fn === 'list_church_teams') return { data: [{ id: 't-louvor', name: 'Louvor', leader_member_id: 'mariana' }], error: null };
          if (fn === 'list_service_templates') return { data: [tpl], error: null };
          if (fn === 'get_service_template') return { data: [tpl], error: null };
          if (fn === 'create_church_event_edition') return canonicalCreateEventReceipt(params, 'ev-counter-1');
          if (fn === 'create_event_item') {
            const itemId = `srv-item-${params.p_sequence_order}`;
            return {
              data: [{
                id: `rec-item-${params.p_sequence_order}`,
                command_id: params.p_command_id,
                action: 'create_event_item',
                church_id: params.p_church_id,
                result_entity_id: itemId,
                result_payload: { item_id: itemId, event_id: params.p_event_id },
                created_at: '2026-11-01T00:00:00Z',
              }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };

      let liturgyTree;
      await act(async () => {
        liturgyTree = TestRenderer.create(
          React.createElement(AppProvider, { initialUserId: 'marcos', churchId: CHURCH_ID, supabaseClient: mockClient },
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        );
      });

      await act(async () => {
        await appCtx.createEventEdition({
          title: 'Culto Dirigido por Carlos',
          type: 'Culto',
          plannedStartAt: '2026-11-01T19:00',
          plannedEndAt: '2026-11-01T20:30',
          liturgyLeaderId: 'carlos',
          activities: [
            { id: 'a1', title: 'Oração', category: 'Liturgia', plannedDurationMinutes: 10 },
            { id: 'a2', title: 'Louvor', category: 'Louvor', plannedDurationMinutes: 20 },
          ],
          parallelServices: [
            { id: 's1', teamId: 't-louvor', name: 'Transmissão', prepRequiredMinutes: 15, status: 'Aguardando culto' },
          ],
        });
      });

      await act(async () => {
        appCtx.setCurrentUserId('carlos');
      });

      const root = liturgyTree.root;
      assert.equal(root.find(n => n.type === 'button' && n.props?.id === 'btn-open-create-event-modal').props.disabled, true);
      assert.equal(root.find(n => n.type === 'select' && n.props?.id === 'select-duration-policy').props.disabled, false);
      assert.equal(root.find(n => n.type === 'button' && n.props?.id === 'btn-save-program-draft').props.disabled, false);
      assert.equal(root.find(n => n.type === 'button' && n.props?.id === 'btn-publish-program').props.disabled, false);

      const templateSelect = root.find(n => n.type === 'select' && n.props?.id === 'select-service-template');
      assert.equal(templateSelect.props.disabled, false);
      const firstTemplateOption = templateSelect.findAll(n => n.type === 'option').find(o => o.props.value);
      assert.ok(firstTemplateOption);

      await act(async () => {
        templateSelect.props.onChange({ target: { value: firstTemplateOption.props.value } });
      });

      assert.equal(root.find(n => n.type === 'button' && n.props?.id === 'btn-apply-service-template').props.disabled, false);
      assert.equal(root.find(n => n.type === 'button' && n.props?.id === 'btn-open-new-activity-modal').props.disabled, false);

      const editBtns = findEditActivityButtons(root);
      assert.ok(editBtns.length >= 1);
      assert.ok(editBtns.every(b => b.props.disabled === false));

      const moveUpBtns = root.findAll(
        n => n.type === 'button' && typeof n.props?.id === 'string' && n.props.id.startsWith('btn-move-up-')
      );
      const moveDownBtns = root.findAll(
        n => n.type === 'button' && typeof n.props?.id === 'string' && n.props.id.startsWith('btn-move-down-')
      );
      assert.ok(moveUpBtns.length >= 2);
      assert.ok(moveDownBtns.length >= 2);
      assert.equal(moveUpBtns[0].props.disabled, true);
      assert.equal(moveDownBtns[moveDownBtns.length - 1].props.disabled, true);
      assert.ok(moveUpBtns.slice(1).every(b => b.props.disabled === false));
      assert.ok(moveDownBtns.slice(0, -1).every(b => b.props.disabled === false));

      const removeParallelBtns = root.findAll(
        n => n.type === 'button' && typeof n.props?.id === 'string' && n.props.id.startsWith('btn-remove-parallel-service-')
      );
      assert.ok(removeParallelBtns.length >= 1);
      assert.ok(removeParallelBtns.every(b => b.props.disabled === false));
    });
  });
});
