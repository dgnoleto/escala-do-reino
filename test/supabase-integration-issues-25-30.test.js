import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  fetchCancellationReasonsRemote,
  createCancellationReasonRemote,
  updateCancellationReasonRemote,
  toggleCancellationReasonStatusRemote,
  deleteCancellationReasonRemote,
  cancellationReasonErrorMessage,
  generateCommandUuid,
} from '../src/utils/cancellationReasonService.js';

import {
  fetchEventTypesRemote,
  createEventTypeRemote,
  updateEventTypeRemote,
  toggleEventTypeStatusRemote,
  deleteEventTypeRemote,
  fetchStandardActivitiesRemote,
  createStandardActivityRemote,
  updateStandardActivityRemote,
  toggleStandardActivityStatusRemote,
  deleteStandardActivityRemote,
  eventTypeActivityErrorMessage,
} from '../src/utils/eventTypeActivityService.js';

import {
  fetchServiceTemplatesRemote,
  getServiceTemplateRemote,
  createServiceTemplateRemote,
  updateServiceTemplateRemote,
  toggleServiceTemplateStatusRemote,
  deleteServiceTemplateRemote,
  instantiateServiceTemplateRemote,
  serviceTemplateErrorMessage,
} from '../src/utils/serviceTemplateService.js';

import {
  createChurchEventEditionRemote,
  reorderEventItemsRemote,
  setEventDurationPolicyRemote,
  publishEventProgramRemote,
  saveEventProgramDraftRemote,
  eventPlanningErrorMessage,
} from '../src/utils/eventPlanningService.js';

// Prepara bundle com JSX para execução segura em Node.js
const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'supabase-integration-components.bundle.mjs');

await build({
  stdin: {
    contents: `
      export { AppProvider, useApp } from './src/context/AppContext.jsx';
      export { default as AdminView } from './src/components/AdminView.jsx';
    `,
    resolveDir: process.cwd(),
    loader: 'jsx',
  },
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['react', 'react-dom', 'lucide-react'],
});

const { AppProvider, useApp, AdminView } = await import(
  pathToFileURL(bundlePath).href
);

// Mock de ambiente DOM para Node.js
globalThis.document = {
  documentElement: {
    setAttribute: () => {},
    getAttribute: () => null,
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  visibilityState: 'visible',
};

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};

describe('Integração Frontend-RPCs Supabase (Issues #25 a #30)', () => {
  const TEST_CHURCH_A = '11111111-1111-1111-1111-111111111111';
  const TEST_CHURCH_B = '22222222-2222-2222-2222-222222222222';

  describe('1. Mapeamento de Erros e Códigos PostgreSQL/PostgREST', () => {
    test('1.1 Erro 42501 é identificado como permissão insuficiente em todos os serviços', () => {
      const err = { code: '42501', message: 'permission denied for function' };
      assert.match(cancellationReasonErrorMessage(err), /Apenas administradores/);
      assert.match(eventTypeActivityErrorMessage(err), /Apenas administradores/);
      assert.match(serviceTemplateErrorMessage(err), /Apenas administradores/);
      assert.match(eventPlanningErrorMessage(err), /Permissão insuficiente/);
    });

    test('1.2 Erro 23505 é identificado como conflito de unicidade/duplicidade', () => {
      const err = { code: '23505', message: 'duplicate key value violates unique constraint' };
      assert.match(cancellationReasonErrorMessage(err), /Já existe um motivo/);
      assert.match(eventTypeActivityErrorMessage(err), /Já existe um cadastro/);
      assert.match(serviceTemplateErrorMessage(err), /Já existe um modelo/);
    });

    test('1.3 Erro 23503 é identificado como preservação histórica (FK referenciada)', () => {
      const err = { code: '23503', message: 'violates foreign key constraint' };
      assert.match(cancellationReasonErrorMessage(err), /cancelamentos históricos/);
      assert.match(eventTypeActivityErrorMessage(err), /cultos históricos/);
      assert.match(serviceTemplateErrorMessage(err), /eventos históricos/);
    });

    test('1.4 Falhas de rede/transporte são identificadas sem crash', () => {
      const netErr = new Error('Failed to fetch');
      assert.match(cancellationReasonErrorMessage(netErr), /Falha de conexão/);
      assert.match(eventTypeActivityErrorMessage(netErr), /Falha de conexão/);
      assert.match(serviceTemplateErrorMessage(netErr), /Falha de conexão/);
      assert.match(eventPlanningErrorMessage(netErr), /Falha de conexão/);
    });

    test('1.5 UUID de comando cliente é gerado de forma compatível com v4', () => {
      const uuid = generateCommandUuid();
      assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  describe('2. Camadas de Serviço: Chamadas de RPC e Parâmetros Multi-tenant', () => {
    test('2.1 Motivos de cancelamento envia p_church_id e parâmetros obrigatórios', async () => {
      let rpcNameCalled = null;
      let rpcParamsCalled = null;

      const mockClient = {
        rpc: async (fn, params) => {
          rpcNameCalled = fn;
          rpcParamsCalled = params;
          return { data: { id: 'cr-100', name: params.p_name }, error: null };
        }
      };

      const res = await createCancellationReasonRemote(mockClient, TEST_CHURCH_A, 'Queda de energia');
      assert.equal(res.success, true);
      assert.equal(rpcNameCalled, 'create_cancellation_reason');
      assert.equal(rpcParamsCalled.p_church_id, TEST_CHURCH_A);
      assert.equal(rpcParamsCalled.p_name, 'Queda de energia');
      assert.ok(rpcParamsCalled.p_command_id);
    });

    test('2.2 Tipos de evento e atividades padrão enviam p_church_id e isolamento', async () => {
      let calls = [];
      const mockClient = {
        rpc: async (fn, params) => {
          calls.push({ fn, params });
          return { data: { id: 'obj-1' }, error: null };
        }
      };

      await createEventTypeRemote(mockClient, TEST_CHURCH_A, 'Culto Especial', 'Culto de celebração');
      await createStandardActivityRemote(mockClient, TEST_CHURCH_A, 'Ofertório', 7, 'Liturgia', 'Momento de dízimos');

      assert.equal(calls[0].fn, 'create_event_type');
      assert.equal(calls[0].params.p_church_id, TEST_CHURCH_A);
      assert.equal(calls[0].params.p_name, 'Culto Especial');

      assert.equal(calls[1].fn, 'create_standard_activity');
      assert.equal(calls[1].params.p_church_id, TEST_CHURCH_A);
      assert.equal(calls[1].params.p_default_duration_minutes, 7);
    });

    test('2.3 Modelos de culto envia estrutura estruturada JSON', async () => {
      let rpcParams = null;
      const mockClient = {
        rpc: async (fn, params) => {
          rpcParams = params;
          return { data: { id: 'tpl-1' }, error: null };
        }
      };

      const templateData = {
        name: 'Culto de Celebração Noturno',
        description: 'Estrutura completa',
        eventTypeId: 'et-1',
        activities: [{ title: 'Abertura', plannedDurationMinutes: 5 }],
        parallelServices: [{ name: 'Berçário' }]
      };

      const res = await createServiceTemplateRemote(mockClient, TEST_CHURCH_A, templateData);
      assert.equal(res.success, true);
      assert.equal(rpcParams.p_church_id, TEST_CHURCH_A);
      assert.equal(rpcParams.p_name, 'Culto de Celebração Noturno');
      assert.equal(Array.isArray(rpcParams.p_activities), true);
      assert.equal(rpcParams.p_activities.length, 1);
    });

    test('2.4 Criação e publicação de edições (Event Planning)', async () => {
      let planningCalls = [];
      const mockClient = {
        rpc: async (fn, params) => {
          planningCalls.push({ fn, params });
          return { data: { id: 'ev-1', program_version: 2 }, error: null };
        }
      };

      const createRes = await createChurchEventEditionRemote(mockClient, TEST_CHURCH_A, {
        title: 'Culto de Domingo Noite',
        event_date: '2026-11-01',
        start_time: '19:00',
        duration_policy: 'warn',
        planned_duration_minutes: 105,
        items: []
      });

      assert.equal(createRes.success, true);

      const pubRes = await publishEventProgramRemote(mockClient, TEST_CHURCH_A, 'ev-1', 1, []);
      assert.equal(pubRes.success, true);

      assert.equal(planningCalls[0].fn, 'create_church_event_edition');
      assert.equal(planningCalls[0].params.p_church_id, TEST_CHURCH_A);
      assert.equal(planningCalls[0].params.p_duration_policy, 'warn');

      assert.equal(planningCalls[1].fn, 'publish_event_program');
      assert.equal(planningCalls[1].params.p_church_id, TEST_CHURCH_A);
      assert.equal(planningCalls[1].params.p_event_id, 'ev-1');
    });

    test('2.5 Validação estrita de domínio: rejeição de políticas de duração espúrias', async () => {
      const mockClient = {
        rpc: async () => ({ data: { id: 'ev-test' }, error: null })
      };

      const res = await createChurchEventEditionRemote(mockClient, TEST_CHURCH_A, {
        title: 'Culto com Política Inválida',
        event_date: '2026-11-01',
        start_time: '19:00',
        duration_policy: 'horario_termino_variavel',
        items: []
      });

      assert.equal(res.success, false);
      assert.match(res.error, /Política de duração inválida/);
      assert.match(res.error, /warn.*block/);
    });

    test('2.6 Validação de compatibilidade contratual de parâmetros com RPCs (020 a 023)', async () => {
      let intercepted = [];
      const capturingClient = {
        rpc: async (fn, params) => {
          intercepted.push({ fn, params });
          return { data: [], error: null };
        }
      };

      // 020: Consulta, atualização e alternância de status de motivos
      await fetchCancellationReasonsRemote(capturingClient, TEST_CHURCH_A, true);
      assert.equal(intercepted[0].fn, 'list_cancellation_reasons');
      assert.equal(intercepted[0].params.p_church_id, TEST_CHURCH_A);
      assert.equal(intercepted[0].params.p_only_active, false);
      assert.equal(intercepted[0].params.p_include_inactive, undefined);

      await updateCancellationReasonRemote(capturingClient, TEST_CHURCH_A, 'cr-1', 'Novo Motivo');
      assert.equal(intercepted[1].fn, 'update_cancellation_reason');
      assert.equal(intercepted[1].params.p_new_name, 'Novo Motivo');

      await toggleCancellationReasonStatusRemote(capturingClient, TEST_CHURCH_A, 'cr-1', false);
      assert.equal(intercepted[2].fn, 'toggle_cancellation_reason_status');
      assert.equal(intercepted[2].params.p_active, false);

      // 021: Consulta de tipos e atividades padrão
      await fetchEventTypesRemote(capturingClient, TEST_CHURCH_A, true);
      assert.equal(intercepted[3].fn, 'list_event_types');
      assert.equal(intercepted[3].params.p_only_active, false);
      assert.equal(intercepted[3].params.p_include_inactive, undefined);

      await fetchStandardActivitiesRemote(capturingClient, TEST_CHURCH_A, true);
      assert.equal(intercepted[4].fn, 'list_standard_activities');
      assert.equal(intercepted[4].params.p_only_active, false);
      assert.equal(intercepted[4].params.p_include_inactive, undefined);

      // 022: Modelos de culto (contrato estrito)
      await fetchServiceTemplatesRemote(capturingClient, TEST_CHURCH_A, true);
      assert.equal(intercepted[5].fn, 'list_service_templates');
      assert.equal(intercepted[5].params.p_only_active, false);

      await getServiceTemplateRemote(capturingClient, { templateId: 'tpl-123' });
      assert.equal(intercepted[6].fn, 'get_service_template');
      assert.equal(intercepted[6].params.p_template_id, 'tpl-123');
      assert.equal(intercepted[6].params.p_church_id, undefined);

      await updateServiceTemplateRemote(capturingClient, TEST_CHURCH_A, 'tpl-123', { name: 'Modelo Atualizado' });
      assert.equal(intercepted[7].fn, 'update_service_template');
      assert.equal(intercepted[7].params.p_church_id, undefined);

      await toggleServiceTemplateStatusRemote(capturingClient, TEST_CHURCH_A, 'tpl-123', false);
      assert.equal(intercepted[8].fn, 'toggle_service_template_status');
      assert.equal(intercepted[8].params.p_active, false);
      assert.equal(intercepted[8].params.p_church_id, undefined);

      await deleteServiceTemplateRemote(capturingClient, TEST_CHURCH_A, 'tpl-123');
      assert.equal(intercepted[9].fn, 'delete_service_template');
      assert.equal(intercepted[9].params.p_church_id, undefined);

      await instantiateServiceTemplateRemote(capturingClient, TEST_CHURCH_A, 'tpl-123');
      assert.equal(intercepted[10].fn, 'instantiate_service_template');
      assert.equal(intercepted[10].params.p_event_id, undefined);
    });
  });

  describe('3. Integração AppContext: Supabase Remoto vs Fallback Local', () => {
    test('3.1 Em modo remoto, AppContext não atualiza estado e retorna erro se backend falhar (42501)', async () => {
      let appContext = null;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      const failingClient = {
        rpc: async () => ({
          data: null,
          error: { code: '42501', message: 'permission denied' }
        })
      };

      await act(async () => {
        TestRenderer.create(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              churchId: TEST_CHURCH_A,
              supabaseClient: failingClient
            },
            React.createElement(TestConsumer)
          )
        );
      });

      assert.equal(appContext.isRemoteConfigured, true);
      const initialCount = appContext.cancelReasons.length;

      // Executa mutação que deve bater no Supabase e ser rejeitada
      let res;
      await act(async () => {
        res = await appContext.addCancelReason('Motivo não autorizado');
      });

      // Não sinaliza sucesso
      assert.equal(res.success, false);
      assert.match(res.error, /Apenas administradores/);
      // Estado React NÃO foi alterado
      assert.equal(appContext.cancelReasons.length, initialCount);
      assert.equal(appContext.cancelReasons.some(r => r.name === 'Motivo não autorizado'), false);
    });

    test('3.2 Em modo remoto, AppContext atualiza estado após sucesso confirmado no backend', async () => {
      let appContext = null;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      const existingReasons = [
        { id: 'cr-1', name: 'Queda de energia', active: true, created_at: new Date().toISOString() },
        { id: 'cr-2', name: 'Microfone danificado', active: true, created_at: new Date().toISOString() }
      ];

      const successClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_cancellation_reasons') {
            return { data: existingReasons, error: null };
          }
          if (fn === 'create_cancellation_reason') {
            return {
              data: {
                id: 'cr-remote-999',
                name: params.p_name,
                created_at: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              },
              error: null
            };
          }
          return { data: [], error: null };
        }
      };

      await act(async () => {
        TestRenderer.create(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              churchId: TEST_CHURCH_A,
              supabaseClient: successClient
            },
            React.createElement(TestConsumer)
          )
        );
      });

      const initialCount = appContext.cancelReasons.length;
      assert.equal(initialCount, 2);

      let res;
      await act(async () => {
        res = await appContext.addCancelReason('Chuva Torrencial e Alagamento');
      });

      assert.equal(res.success, true);
      assert.equal(res.remote, true);
      assert.equal(appContext.cancelReasons.length, initialCount + 1);
      const found = appContext.cancelReasons.find(r => r.name === 'Chuva Torrencial e Alagamento');
      assert.ok(found);
      assert.equal(found.id, 'cr-remote-999');
    });

    test('3.3 Publicação remota rejeita concorrência e não atualiza versão local em caso de conflito', async () => {
      let appContext = null;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      const conflictClient = {
        rpc: async (fn) => {
          if (fn === 'publish_event_program') {
            return {
              data: null,
              error: { code: 'P0001', message: 'Versão da programação desatualizada (conflito de publicação)' }
            };
          }
          return { data: [], error: null };
        }
      };

      await act(async () => {
        TestRenderer.create(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              churchId: TEST_CHURCH_A,
              supabaseClient: conflictClient
            },
            React.createElement(TestConsumer)
          )
        );
      });

      const initialVersion = appContext.event.programVersion || 1;

      let res;
      await act(async () => {
        res = await appContext.publishCurrentProgram();
      });

      assert.equal(res.success, false);
      assert.match(res.error, /conflito/i);
      // Versão local não mudou
      assert.equal(appContext.event.programVersion || 1, initialVersion);
    });

    test('3.4 Bloqueio estrito de fallback local em ambiente real sem contexto autorizado', async () => {
      let appContext = null;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      // Configurado com allowMemoryFallback: false para simular ambiente real sem Supabase
      await act(async () => {
        TestRenderer.create(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              allowMemoryFallback: false,
            },
            React.createElement(TestConsumer)
          )
        );
      });

      assert.equal(appContext.isRemoteConfigured, false);
      assert.equal(appContext.isMemoryFallbackAllowed, false);
      const initialReasonsCount = appContext.cancelReasons.length;

      let res;
      await act(async () => {
        res = await appContext.addCancelReason('Tentativa Sem Conexão');
      });

      // Gravação deve ser bloqueada estritamente e retornar erro claro
      assert.equal(res.success, false);
      assert.match(res.error, /Operação não permitida.*sem conexão autorizada.*Gravação bloqueada/);
      assert.equal(appContext.cancelReasons.length, initialReasonsCount);
    });

    test('3.5 Falha de rede ou timeout remoto não corrompe nem atualiza estado local', async () => {
      let appContext = null;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      const timeoutClient = {
        rpc: async () => {
          throw new Error('TypeError: Failed to fetch (Timeout de rede)');
        }
      };

      await act(async () => {
        TestRenderer.create(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              churchId: TEST_CHURCH_A,
              supabaseClient: timeoutClient
            },
            React.createElement(TestConsumer)
          )
        );
      });

      const initialCount = appContext.eventTypes.length;

      let res;
      await act(async () => {
        res = await appContext.addEventType('Tipo Durante Falha de Rede');
      });

      assert.equal(res.success, false);
      assert.match(res.error, /Falha (de conexão|na comunicação)/);
      assert.equal(appContext.eventTypes.length, initialCount);
    });

    test('3.6 Isolamento multi-tenant: troca de igreja limpa estado em memória e previne contaminação', async () => {
      let appContext = null;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      const multiTenantClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_cancellation_reasons') {
            if (params.p_church_id === TEST_CHURCH_A) {
              return { data: [{ id: 'cr-a1', name: 'Motivo Igreja A', active: true }], error: null };
            }
            if (params.p_church_id === TEST_CHURCH_B) {
              return { data: [{ id: 'cr-b1', name: 'Motivo Igreja B', active: true }], error: null };
            }
          }
          return { data: [], error: null };
        }
      };

      let renderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              churchId: TEST_CHURCH_A,
              supabaseClient: multiTenantClient
            },
            React.createElement(TestConsumer)
          )
        );
      });

      assert.equal(appContext.effectiveChurchId, TEST_CHURCH_A);
      assert.equal(appContext.cancelReasons.length, 1);
      assert.equal(appContext.cancelReasons[0].name, 'Motivo Igreja A');

      // Troca para Igreja B
      await act(async () => {
        renderer.update(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              churchId: TEST_CHURCH_B,
              supabaseClient: multiTenantClient
            },
            React.createElement(TestConsumer)
          )
        );
      });

      assert.equal(appContext.effectiveChurchId, TEST_CHURCH_B);
      assert.equal(appContext.cancelReasons.length, 1);
      assert.equal(appContext.cancelReasons[0].name, 'Motivo Igreja B');
      assert.equal(appContext.cancelReasons.some(r => r.name === 'Motivo Igreja A'), false);
    });
  });

  describe('4. Regressão Issue #26: Tratamento de Resposta Remota e Identificador Persistido', () => {
    test('4.1 Resposta válida conserva o UUID retornado (serviço e AppContext)', async () => {
      const validUuid = 'c78b40bf-9844-4dd2-8b80-87779d71c4a0';
      const validClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_cancellation_reasons') {
            return { data: [], error: null };
          }
          if (fn === 'create_cancellation_reason') {
            return {
              data: [{ id: validUuid, name: params.p_name, active: true, command_id: params.p_command_id }],
              error: null
            };
          }
          return { data: [], error: null };
        }
      };

      // 1. Serviço unitário
      const svcRes = await createCancellationReasonRemote(validClient, TEST_CHURCH_A, 'Manutenção Emergencial');
      assert.equal(svcRes.success, true);
      assert.equal(svcRes.reason.id, validUuid);
      assert.equal(svcRes.data.id, validUuid);
      assert.equal(svcRes.reason.id.startsWith('cr-'), false);

      // 2. AppContext remoto
      let appContext = null;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      await act(async () => {
        TestRenderer.create(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              churchId: TEST_CHURCH_A,
              supabaseClient: validClient
            },
            React.createElement(TestConsumer)
          )
        );
      });

      let ctxRes;
      await act(async () => {
        ctxRes = await appContext.addCancelReason('Manutenção Emergencial');
      });

      assert.equal(ctxRes.success, true);
      assert.equal(ctxRes.remote, true);
      assert.equal(ctxRes.reason.id, validUuid);
      const inState = appContext.cancelReasons.find(r => r.name === 'Manutenção Emergencial');
      assert.ok(inState);
      assert.equal(inState.id, validUuid);
    });

    test('4.2 Resposta vazia não produz sucesso nem item local (serviço e AppContext)', async () => {
      const emptyArrayClient = {
        rpc: async (fn) => {
          if (fn === 'list_cancellation_reasons') {
            return { data: [{ id: 'cr-initial', name: 'Motivo Existente', active: true }], error: null };
          }
          if (fn === 'create_cancellation_reason') {
            return { data: [], error: null };
          }
          return { data: [], error: null };
        }
      };

      // 1. Serviço unitário com data: []
      const svcRes = await createCancellationReasonRemote(emptyArrayClient, TEST_CHURCH_A, 'Queda de Energia');
      assert.equal(svcRes.success, false);
      assert.equal(svcRes.reason, undefined);
      assert.match(svcRes.error, /identificador persistido/i);
      assert.match(svcRes.error, /confira os dados/i);

      // 2. Serviço unitário com data: null
      const nullClient = {
        rpc: async (fn) => {
          if (fn === 'create_cancellation_reason') {
            return { data: null, error: null };
          }
          return { data: [], error: null };
        }
      };
      const svcResNull = await createCancellationReasonRemote(nullClient, TEST_CHURCH_A, 'Queda de Energia');
      assert.equal(svcResNull.success, false);
      assert.equal(svcResNull.reason, undefined);
      assert.match(svcResNull.error, /identificador persistido/i);

      // 3. AppContext remoto
      let appContext = null;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      await act(async () => {
        TestRenderer.create(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              churchId: TEST_CHURCH_A,
              supabaseClient: emptyArrayClient
            },
            React.createElement(TestConsumer)
          )
        );
      });

      const initialCount = appContext.cancelReasons.length;
      assert.equal(initialCount, 1);

      let ctxRes;
      await act(async () => {
        ctxRes = await appContext.addCancelReason('Queda de Energia');
      });

      assert.equal(ctxRes.success, false);
      assert.match(ctxRes.error, /identificador persistido/i);
      assert.equal(appContext.cancelReasons.length, initialCount);
      assert.equal(appContext.cancelReasons.some(r => r.name === 'Queda de Energia'), false);
    });

    test('4.3 Resposta sem identificador tem o mesmo tratamento (serviço e AppContext)', async () => {
      const noIdClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_cancellation_reasons') {
            return { data: [{ id: 'cr-initial', name: 'Motivo Existente', active: true }], error: null };
          }
          if (fn === 'create_cancellation_reason') {
            return {
              data: [{ name: params.p_name, active: true, command_id: params.p_command_id }],
              error: null
            };
          }
          return { data: [], error: null };
        }
      };

      // 1. Serviço unitário
      const svcRes = await createCancellationReasonRemote(noIdClient, TEST_CHURCH_A, 'Microfone Danificado');
      assert.equal(svcRes.success, false);
      assert.equal(svcRes.reason, undefined);
      assert.match(svcRes.error, /identificador persistido/i);

      // 2. AppContext remoto
      let appContext = null;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      await act(async () => {
        TestRenderer.create(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              churchId: TEST_CHURCH_A,
              supabaseClient: noIdClient
            },
            React.createElement(TestConsumer)
          )
        );
      });

      const initialCount = appContext.cancelReasons.length;
      assert.equal(initialCount, 1);

      let ctxRes;
      await act(async () => {
        ctxRes = await appContext.addCancelReason('Microfone Danificado');
      });

      assert.equal(ctxRes.success, false);
      assert.match(ctxRes.error, /identificador persistido/i);
      assert.equal(appContext.cancelReasons.length, initialCount);
      assert.equal(appContext.cancelReasons.some(r => r.name === 'Microfone Danificado'), false);
    });

    test('4.4 Erro remoto preserva o estado anterior (serviço e AppContext)', async () => {
      const errorClient = {
        rpc: async (fn) => {
          if (fn === 'list_cancellation_reasons') {
            return { data: [{ id: 'cr-initial', name: 'Motivo Existente', active: true }], error: null };
          }
          if (fn === 'create_cancellation_reason') {
            return {
              data: null,
              error: { code: '42501', message: 'Permissão insuficiente' }
            };
          }
          return { data: [], error: null };
        }
      };

      // 1. Serviço unitário
      const svcRes = await createCancellationReasonRemote(errorClient, TEST_CHURCH_A, 'Falta de Água');
      assert.equal(svcRes.success, false);
      assert.match(svcRes.error, /Permissão insuficiente/i);

      // 2. AppContext remoto
      let appContext = null;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      await act(async () => {
        TestRenderer.create(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              churchId: TEST_CHURCH_A,
              supabaseClient: errorClient
            },
            React.createElement(TestConsumer)
          )
        );
      });

      const initialCount = appContext.cancelReasons.length;
      assert.equal(initialCount, 1);

      let ctxRes;
      await act(async () => {
        ctxRes = await appContext.addCancelReason('Falta de Água');
      });

      assert.equal(ctxRes.success, false);
      assert.match(ctxRes.error, /Permissão insuficiente/i);
      assert.equal(appContext.cancelReasons.length, initialCount);
      assert.equal(appContext.cancelReasons.some(r => r.name === 'Falta de Água'), false);
    });

    test('4.5 Tratamento de falha no AdminView mantém o formulário preenchido sem exibir sucesso', async () => {
      const failingEmptyClient = {
        rpc: async (fn) => {
          if (fn === 'list_cancellation_reasons') {
            return { data: [{ id: 'cr-initial', name: 'Motivo Existente', active: true }], error: null };
          }
          if (fn === 'create_cancellation_reason') {
            return { data: [], error: null };
          }
          return { data: [], error: null };
        }
      };

      let renderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            AppProvider,
            {
              initialUserId: 'marcos',
              churchId: TEST_CHURCH_A,
              supabaseClient: failingEmptyClient
            },
            React.createElement(AdminView, { initialTab: 'reasons' })
          )
        );
      });

      const typedReason = 'Chuva torrencial e destelhamento do salão';

      // Localiza input de novo motivo
      const input = renderer.root.findByProps({ id: 'new-cancel-reason-input' });
      assert.ok(input);

      // Simula digitação no input
      await act(async () => {
        input.props.onChange({ target: { value: typedReason } });
      });

      // Localiza o formulário de cadastro
      const form = renderer.root.findByType('form');
      assert.ok(form);

      // Submete o formulário com o mock retornando resposta vazia
      await act(async () => {
        await form.props.onSubmit({ preventDefault: () => {} });
      });

      // 1. Formulário permanece preenchido com o texto digitado
      const inputAfter = renderer.root.findByProps({ id: 'new-cancel-reason-input' });
      assert.equal(inputAfter.props.value, typedReason);

      // 2. Mensagem de erro exibida orientando conferência
      const errorAlerts = renderer.root.findAllByProps({ className: 'alert alert-danger' });
      assert.ok(errorAlerts.length > 0);
      const errorSpan = errorAlerts[0].findByType('span');
      const errorText = errorSpan.children.join('');
      assert.match(errorText, /identificador persistido/i);

      // 3. Nenhuma mensagem de sucesso é exibida
      const successAlerts = renderer.root.findAllByProps({ className: 'alert alert-success' });
      assert.equal(successAlerts.length, 0);

      // 4. Lista de motivos continua apenas com o motivo inicial, nenhum item espúrio incluído
      const itemRows = renderer.root.findAllByProps({ className: 'reason-item-row' });
      assert.equal(itemRows.length, 1);
    });
  });
});

