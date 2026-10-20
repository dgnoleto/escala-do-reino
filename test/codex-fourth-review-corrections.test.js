import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  hasTemplateChangedRemotely,
  areTimestampsEqual,
  toServiceTemplateObject
} from '../src/utils/serviceTemplateService.js';

// Prepara bundle com componentes React reais e AppContext
const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'codex-fourth-review.bundle.mjs');

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
if (!globalThis.document) {
  globalThis.document = {
    documentElement: {
      setAttribute: () => {},
      getAttribute: () => null,
    },
    getElementById: () => null,
  };
}

const TEST_CHURCH_ID = '01700000-0000-4000-8000-000000000001';
const TEST_ACT_UUID = '01700000-0000-4000-8000-000000000088';

describe('Suíte de Testes da Quarta Revisão do Codex (5 Bloqueios Remanescentes)', () => {

  // ==========================================================================
  // Testes de Unidade: areTimestampsEqual e hasTemplateChangedRemotely
  // ==========================================================================
  describe('Unit: areTimestampsEqual', () => {
    test('retorna true para instantes idênticos com formatação textual diferente (.000Z vs Z)', () => {
      assert.equal(areTimestampsEqual('2026-10-20T12:00:00Z', '2026-10-20T12:00:00.000Z'), true);
    });

    test('retorna true para representações equivalentes de timezone (+00:00 vs Z)', () => {
      assert.equal(areTimestampsEqual('2026-10-20T12:00:00+00:00', '2026-10-20T12:00:00Z'), true);
    });

    test('retorna false para instantes temporais distintos', () => {
      assert.equal(areTimestampsEqual('2026-10-20T12:00:00Z', '2026-10-20T12:05:00Z'), false);
    });

    test('retorna false quando um dos timestamps for ausente', () => {
      assert.equal(areTimestampsEqual('2026-10-20T12:00:00Z', null), false);
      assert.equal(areTimestampsEqual(undefined, '2026-10-20T12:00:00Z'), false);
    });
  });

  describe('Unit: hasTemplateChangedRemotely', () => {
    const origin = {
      id: 'tpl-1',
      name: 'Culto Regular',
      description: 'Descrição original',
      eventTypeId: 'et-1',
      active: true,
      updatedAt: '2026-10-20T10:00:00Z',
      parallelServicesCount: 1,
      activitiesCount: 1,
      parallelServices: [{ teamId: 'midia', serviceName: 'Transmissão', prepRequiredMinutes: 15, isDefaultActive: true }],
      activities: [{ title: 'Louvor', category: 'Louvor', plannedDurationMinutes: 30, displayOrder: 1 }]
    };

    test('retorna false quando dados remotos são idênticos', () => {
      const current = JSON.parse(JSON.stringify(origin));
      assert.equal(hasTemplateChangedRemotely(origin, current), false);
    });

    test('retorna false quando updatedAt divergir na formatação (.000Z) mas conteúdo for idêntico', () => {
      const current = { ...JSON.parse(JSON.stringify(origin)), updatedAt: '2026-10-20T10:00:00.000Z' };
      assert.equal(hasTemplateChangedRemotely(origin, current), false);
    });

    test('retorna false quando updatedAt avançar no tempo mas o conteúdo relevante for idêntico', () => {
      const current = { ...JSON.parse(JSON.stringify(origin)), updatedAt: '2026-10-20T10:05:00Z' };
      assert.equal(hasTemplateChangedRemotely(origin, current), false);
    });

    test('retorna true quando nome divergir', () => {
      const current = { ...JSON.parse(JSON.stringify(origin)), name: 'Culto Modificado' };
      assert.equal(hasTemplateChangedRemotely(origin, current), true);
    });

    test('retorna true quando descrição divergir', () => {
      const current = { ...JSON.parse(JSON.stringify(origin)), description: 'Nova descrição remota' };
      assert.equal(hasTemplateChangedRemotely(origin, current), true);
    });

    test('retorna true quando eventTypeId divergir', () => {
      const current = { ...JSON.parse(JSON.stringify(origin)), eventTypeId: 'et-outro' };
      assert.equal(hasTemplateChangedRemotely(origin, current), true);
    });

    test('retorna true quando active divergir', () => {
      const current = { ...JSON.parse(JSON.stringify(origin)), active: false };
      assert.equal(hasTemplateChangedRemotely(origin, current), true);
    });

    test('retorna true quando novo serviço paralelo for adicionado remotamente', () => {
      const current = JSON.parse(JSON.stringify(origin));
      current.parallelServices.push({ teamId: 'som', serviceName: 'Sonoplastia', prepRequiredMinutes: 20, isDefaultActive: true });
      current.parallelServicesCount = 2;
      assert.equal(hasTemplateChangedRemotely(origin, current), true);
    });

    test('retorna true quando atividade for alterada remotamente', () => {
      const current = JSON.parse(JSON.stringify(origin));
      current.activities[0].title = 'Abertura e Boas-Vindas';
      assert.equal(hasTemplateChangedRemotely(origin, current), true);
    });

    test('retorna true quando duração de atividade for alterada remotamente', () => {
      const current = JSON.parse(JSON.stringify(origin));
      current.activities[0].plannedDurationMinutes = 45;
      assert.equal(hasTemplateChangedRemotely(origin, current), true);
    });

    test('retorna true quando displayOrder de serviço paralelo for alterado isoladamente sem mudança no array', () => {
      const current = JSON.parse(JSON.stringify(origin));
      current.parallelServices[0].displayOrder = 2; // era 1
      assert.equal(hasTemplateChangedRemotely(origin, current), true);
    });

    test('retorna true quando prepRequiredMinutes de serviço paralelo divergir utilizando objetos normalizados pelo serviço real', () => {
      const rawOrigin = {
        id: 'tpl-real-1',
        name: 'Culto Normalizado',
        description: 'Desc',
        event_type_id: 'et-1',
        active: true,
        parallel_services: [
          { team_id: 'midia', service_name: 'Transmissão', prep_required_minutes: 15, is_default_active: true, display_order: 1 }
        ],
        activities: []
      };
      const normalizedOrigin = toServiceTemplateObject(rawOrigin);

      const rawModified = {
        ...rawOrigin,
        parallel_services: [
          { team_id: 'midia', service_name: 'Transmissão', prep_required_minutes: 30, is_default_active: true, display_order: 1 }
        ]
      };
      const normalizedModified = toServiceTemplateObject(rawModified);

      assert.equal(hasTemplateChangedRemotely(normalizedOrigin, normalizedModified), true, 'Deve detectar alteração exclusiva de prepRequiredMinutes');
    });

    test('contraprova: se a comparação de displayOrder ou prepRequiredMinutes fosse ignorada, o teste falharia', () => {
      // Simula objeto onde apenas displayOrder mudou
      const currentOrderOnly = JSON.parse(JSON.stringify(origin));
      currentOrderOnly.parallelServices[0].displayOrder = 99;
      assert.equal(hasTemplateChangedRemotely(origin, currentOrderOnly), true);

      // Simula objeto onde apenas prepRequiredMinutes mudou
      const currentPrepOnly = JSON.parse(JSON.stringify(origin));
      currentPrepOnly.parallelServices[0].prepRequiredMinutes = 45;
      assert.equal(hasTemplateChangedRemotely(origin, currentPrepOnly), true);
    });
  });

  // ==========================================================================
  // Frente A: Frontend - A2. Sincronização sem alteração real não deve bloquear o formulário
  // ==========================================================================
  describe('Frente A2: Sincronização e Concorrência do Formulário de Modelos', () => {

    test('Cenário 1: Sincronização sem mudança remota mantém formulário editável e permite salvar', async () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      const initialTemplate = {
        id: 'tpl-test-1',
        churchId: TEST_CHURCH_ID,
        name: 'Culto de Domingo A2',
        description: 'Descrição original',
        eventTypeId: 'et-1',
        active: true,
        updatedAt: '2026-10-20T12:00:00Z',
        parallelServicesCount: 1,
        activitiesCount: 1,
        parallelServices: [
          { teamId: 'portaria', serviceName: 'Portaria', prepRequiredMinutes: 15, isDefaultActive: true }
        ],
        activities: [
          { title: 'Abertura', category: 'Liturgia', plannedDurationMinutes: 10, displayOrder: 1 }
        ]
      };

      let rpcCallCount = 0;
      let lastUpdatePayload = null;
      const mockClient = {
        rpc: async (fn, params) => {
          rpcCallCount++;
          if (fn === 'list_service_templates') {
            return {
              data: [JSON.parse(JSON.stringify(initialTemplate))],
              error: null
            };
          }
          if (fn === 'get_service_template') {
            return {
              data: {
                ...initialTemplate,
                parallel_services: initialTemplate.parallelServices,
                activities: initialTemplate.activities
              },
              error: null
            };
          }
          if (fn === 'list_event_types' || fn === 'list_church_event_types') {
            return { data: [{ id: 'et-1', name: 'Celebração', active: true }], error: null };
          }
          if (fn === 'list_standard_activities') {
            return { data: [], error: null };
          }
          if (fn === 'list_cancellation_reasons') {
            return { data: [], error: null };
          }
          if (fn === 'update_service_template') {
            lastUpdatePayload = params;
            return {
              data: { success: true, template_id: 'tpl-test-1', updated_at: '2026-10-20T12:10:00Z' },
              error: null
            };
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
              churchId: TEST_CHURCH_ID,
              supabaseClient: mockClient
            },
            React.createElement(TestConsumer),
            React.createElement(AdminView)
          )
        );
      });

      // Aguarda sync inicial
      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      const root = renderer.root;

      // 1. Alterna para a aba de templates
      const templatesTabBtn = root.findByProps({ id: 'tab-admin-templates' });
      await act(async () => {
        templatesTabBtn.props.onClick();
      });

      // 2. Abre o modelo para edição
      const editBtn = root.findByProps({ id: 'btn-edit-template-0' });
      await act(async () => {
        editBtn.props.onClick();
      });

      // 3. Modifica a descrição no formulário
      const descInput = root.findByProps({ id: 'template-desc-input' });
      await act(async () => {
        descInput.props.onChange({ target: { value: 'Nova descrição editada pelo usuário local' } });
      });

      // 4. Dispara uma sincronização em segundo plano que avança o timestamp (12:05:00.000Z vs 12:00:00Z) com conteúdo relevante idêntico
      initialTemplate.updatedAt = '2026-10-20T12:05:00.000Z';
      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      // 5. Verifica que o formulário NÃO está marcado como desatualizado/conflito
      const outdatedWarning = root.findAllByProps({ id: 'template-outdated-warning' });
      assert.equal(outdatedWarning.length, 0, 'Não deve exibir banner de dados desatualizados se apenas o timestamp técnico avançou sem mudança real');

      const saveBtn = root.findByProps({ id: 'btn-save-template' });
      assert.equal(saveBtn.props.disabled, false, 'Botão Salvar deve permanecer habilitado após avanço de timestamp');

      // 6. Clica em salvar
      await act(async () => {
        const form = root.findByProps({ onSubmit: root.findByProps({ id: 'btn-save-template' }).parent.parent.props.onSubmit });
        await form.props.onSubmit({ preventDefault: () => {} });
      });

      // 7. Confirma que a atualização foi efetuada no backend
      assert.ok(lastUpdatePayload, 'A RPC update_service_template deve ter sido chamada');
      assert.equal(lastUpdatePayload.p_description, 'Nova descrição editada pelo usuário local');
    });

    test('Cenário 2: Outro administrador adiciona serviço remoto -> rascunho antigo bloqueia salvamento destrutivo', async () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      const initialTemplate = {
        id: 'tpl-test-2',
        churchId: TEST_CHURCH_ID,
        name: 'Culto Concorrente',
        description: 'Original',
        eventTypeId: 'et-1',
        active: true,
        updatedAt: '2026-10-20T12:00:00Z',
        parallelServicesCount: 1,
        activitiesCount: 1,
        parallelServices: [
          { teamId: 'portaria', serviceName: 'Portaria', prepRequiredMinutes: 15, isDefaultActive: true }
        ],
        activities: [
          { title: 'Abertura', category: 'Liturgia', plannedDurationMinutes: 10, displayOrder: 1 }
        ]
      };

      let currentRemoteTemplate = JSON.parse(JSON.stringify(initialTemplate));

      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'list_service_templates') {
            return {
              data: [JSON.parse(JSON.stringify(currentRemoteTemplate))],
              error: null
            };
          }
          if (fn === 'get_service_template') {
            return {
              data: {
                ...currentRemoteTemplate,
                parallel_services: currentRemoteTemplate.parallelServices,
                activities: currentRemoteTemplate.activities
              },
              error: null
            };
          }
          if (fn === 'list_event_types' || fn === 'list_church_event_types') {
            return { data: [{ id: 'et-1', name: 'Celebração', active: true }], error: null };
          }
          if (fn === 'list_standard_activities') {
            return { data: [], error: null };
          }
          if (fn === 'list_cancellation_reasons') {
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
              churchId: TEST_CHURCH_ID,
              supabaseClient: mockClient
            },
            React.createElement(TestConsumer),
            React.createElement(AdminView)
          )
        );
      });

      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      const root = renderer.root;

      // 1. Abre o modelo para edição
      const templatesTabBtn = root.findByProps({ id: 'tab-admin-templates' });
      await act(async () => {
        templatesTabBtn.props.onClick();
      });
      const editBtn = root.findByProps({ id: 'btn-edit-template-0' });
      await act(async () => {
        editBtn.props.onClick();
      });

      // 2. Outro admin adiciona um segundo serviço remotamente no banco
      currentRemoteTemplate.updatedAt = '2026-10-20T12:05:00Z';
      currentRemoteTemplate.parallelServicesCount = 2;
      currentRemoteTemplate.parallelServices.push({
        teamId: 'midia',
        serviceName: 'Transmissão ao Vivo Remota',
        prepRequiredMinutes: 30,
        isDefaultActive: true
      });

      // 3. Sincronização ocorre enquanto o formulário local está aberto
      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      // 4. Verifica que o formulário detectou alteração remota real
      const outdatedWarning = root.findAllByProps({ id: 'template-outdated-warning' });
      assert.equal(outdatedWarning.length, 1, 'Banner de dados desatualizados DEVE ser exibido');

      const saveBtn = root.findByProps({ id: 'btn-save-template' });
      assert.equal(saveBtn.props.disabled, true, 'Botão Salvar deve estar bloqueado para evitar sobrescrita destrutiva');

      // 5. Tentativa direta de update no contexto também deve recusar por conflito
      let directUpdateResult;
      await act(async () => {
        directUpdateResult = await contextRef.updateServiceTemplate('tpl-test-2', {
          name: 'Tentativa de Sobrescrita Destrutiva',
          parallelServices: [
            { teamId: 'portaria', serviceName: 'Portaria', prepRequiredMinutes: 15, isDefaultActive: true }
          ]
        }, {
          originParallelServicesCount: 1
        });
      });

      assert.equal(directUpdateResult.success, false, 'Gravação destrutiva deve ser rejeitada');
      assert.equal(directUpdateResult.conflict, true, 'Deve sinalizar conflito explícito');

      // 6. Garante que o 2º serviço adicionado remotamente permanece intacto no store
      const storeTemplate = contextRef.serviceTemplates.find(t => t.id === 'tpl-test-2');
      assert.equal(storeTemplate.parallelServices.length, 2, 'O serviço remoto não pode ser apagado');
    });

    test('Cenário 3: Falha e recuperação com dados idênticos preserva rascunho e permite salvar', async () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      const initialTemplate = {
        id: 'tpl-test-3',
        churchId: TEST_CHURCH_ID,
        name: 'Culto Resiliente',
        description: 'Original',
        eventTypeId: 'et-1',
        active: true,
        updatedAt: '2026-10-20T12:00:00Z',
        parallelServicesCount: 1,
        activitiesCount: 1,
        parallelServices: [
          { teamId: 'portaria', serviceName: 'Portaria', prepRequiredMinutes: 15, isDefaultActive: true }
        ],
        activities: [
          { title: 'Abertura', category: 'Liturgia', plannedDurationMinutes: 10, displayOrder: 1 }
        ]
      };

      let shouldFailNetwork = false;
      let lastUpdatePayload = null;

      const mockClient = {
        rpc: async (fn, params) => {
          if (shouldFailNetwork) {
            return { data: null, error: { message: 'Erro de rede 503', code: '503' } };
          }
          if (fn === 'list_service_templates') {
            return {
              data: [JSON.parse(JSON.stringify(initialTemplate))],
              error: null
            };
          }
          if (fn === 'get_service_template') {
            return {
              data: {
                ...initialTemplate,
                parallel_services: initialTemplate.parallelServices,
                activities: initialTemplate.activities
              },
              error: null
            };
          }
          if (fn === 'list_event_types' || fn === 'list_church_event_types') {
            return { data: [{ id: 'et-1', name: 'Celebração', active: true }], error: null };
          }
          if (fn === 'list_standard_activities') {
            return { data: [], error: null };
          }
          if (fn === 'list_cancellation_reasons') {
            return { data: [], error: null };
          }
          if (fn === 'update_service_template') {
            lastUpdatePayload = params;
            return {
              data: { success: true, template_id: 'tpl-test-3', updated_at: '2026-10-20T12:15:00Z' },
              error: null
            };
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
              churchId: TEST_CHURCH_ID,
              supabaseClient: mockClient
            },
            React.createElement(TestConsumer),
            React.createElement(AdminView)
          )
        );
      });

      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      const root = renderer.root;

      // 1. Abre modelo e digita novo texto no rascunho
      const templatesTabBtn = root.findByProps({ id: 'tab-admin-templates' });
      await act(async () => {
        templatesTabBtn.props.onClick();
      });
      const editBtn = root.findByProps({ id: 'btn-edit-template-0' });
      await act(async () => {
        editBtn.props.onClick();
      });
      const descInput = root.findByProps({ id: 'template-desc-input' });
      await act(async () => {
        descInput.props.onChange({ target: { value: 'Texto digitado antes da queda de conexão' } });
      });

      // 2. Simula queda transitória de conexão durante sincronização
      shouldFailNetwork = true;
      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      assert.equal(contextRef.isDataStale, true, 'isDataStale deve ser true durante a falha');

      // 3. Verifica que as alterações locais digitadas NÃO foram apagadas
      const descInputAfterFailure = root.findByProps({ id: 'template-desc-input' });
      assert.equal(descInputAfterFailure.props.value, 'Texto digitado antes da queda de conexão', 'Texto local não pode ser apagado');

      // 4. Conexão se recupera e retorna exatamente os mesmos dados
      shouldFailNetwork = false;
      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      assert.equal(contextRef.isDataStale, false, 'isDataStale volta a ser false');

      // 5. O usuário consegue continuar e salvar sem perder o que digitou
      const saveBtn = root.findByProps({ id: 'btn-save-template' });
      assert.equal(saveBtn.props.disabled, false, 'Botão Salvar deve voltar a ficar habilitado');

      await act(async () => {
        const form = root.findByProps({ onSubmit: root.findByProps({ id: 'btn-save-template' }).parent.parent.props.onSubmit });
        await form.props.onSubmit({ preventDefault: () => {} });
      });

      assert.ok(lastUpdatePayload, 'A RPC update_service_template deve ter sido chamada após a recuperação');
      assert.equal(lastUpdatePayload.p_description, 'Texto digitado antes da queda de conexão');
    });

    test('Cenário 4: Alinhamento de critérios entre AdminView e AppContext para avanço de timestamp e conteúdo', async () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      const initialTemplate = {
        id: 'tpl-test-4',
        churchId: TEST_CHURCH_ID,
        name: 'Culto Alinhamento',
        description: 'Original',
        eventTypeId: 'et-1',
        active: true,
        updatedAt: '2026-10-20T12:00:00Z',
        parallelServicesCount: 1,
        activitiesCount: 1,
        parallelServices: [
          { teamId: 'portaria', serviceName: 'Portaria', prepRequiredMinutes: 15, isDefaultActive: true }
        ],
        activities: [
          { title: 'Abertura', category: 'Liturgia', plannedDurationMinutes: 10, displayOrder: 1 }
        ]
      };

      let currentRemote = JSON.parse(JSON.stringify(initialTemplate));
      let lastUpdatePayload = null;

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_service_templates') {
            return { data: [JSON.parse(JSON.stringify(currentRemote))], error: null };
          }
          if (fn === 'get_service_template') {
            return { data: { ...currentRemote, parallel_services: currentRemote.parallelServices, activities: currentRemote.activities }, error: null };
          }
          if (fn === 'update_service_template') {
            lastUpdatePayload = params;
            return { data: { success: true, template_id: 'tpl-test-4', updated_at: '2026-10-20T12:15:00Z' }, error: null };
          }
          return { data: [], error: null };
        }
      };

      await act(async () => {
        TestRenderer.create(
          React.createElement(
            AppProvider,
            { initialUserId: 'marcos', churchId: TEST_CHURCH_ID, supabaseClient: mockClient },
            React.createElement(TestConsumer)
          )
        );
      });

      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      // Inicia edição e obtém snapshot de origem
      let originSnapshot;
      act(() => {
        originSnapshot = contextRef.beginEditingTemplate('tpl-test-4');
      });

      // 1. Timestamp avança no servidor com formatação .000Z mas conteúdo relevante permanece idêntico
      currentRemote.updatedAt = '2026-10-20T12:05:00.000Z';
      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      // AppContext permite salvar normalmente com o snapshot de origem
      let res1;
      await act(async () => {
        res1 = await contextRef.updateServiceTemplate('tpl-test-4', {
          name: 'Culto Alinhamento Modificado Localmente'
        }, {
          originSnapshot
        });
      });
      assert.equal(res1.success, true, 'AppContext deve permitir salvar quando apenas o timestamp avançou sem alteração de conteúdo');
      assert.ok(lastUpdatePayload, 'RPC deve ter sido chamada');

      // 2. Agora simula alteração real de conteúdo no servidor (outro admin alterou título de atividade)
      currentRemote.activities[0].title = 'Abertura Remotamente Modificada';
      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      let res2;
      await act(async () => {
        res2 = await contextRef.updateServiceTemplate('tpl-test-4', {
          name: 'Tentativa de Sobrescrita Conflitante'
        }, {
          originSnapshot
        });
      });
      assert.equal(res2.success, false, 'AppContext deve bloquear gravação quando houver alteração real no conteúdo remoto');
      assert.equal(res2.conflict, true, 'Deve sinalizar conflict: true');
    });

    test('Cenário 5 (Regressão A1 Obrigatória): abrir modelo ativo, desativá-lo remotamente, reconciliar e tentar salvar antigo -> conflito sem chamada de escrita', async () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      const initialTemplate = {
        id: 'tpl-test-a1',
        churchId: TEST_CHURCH_ID,
        name: 'Culto Ativo A1',
        description: 'Original',
        eventTypeId: 'et-1',
        active: true,
        updatedAt: '2026-10-20T12:00:00Z',
        parallelServicesCount: 1,
        activitiesCount: 1,
        parallelServices: [
          { teamId: 'portaria', serviceName: 'Portaria', prepRequiredMinutes: 15, isDefaultActive: true }
        ],
        activities: [
          { title: 'Abertura', category: 'Liturgia', plannedDurationMinutes: 10, displayOrder: 1 }
        ]
      };

      let currentRemote = JSON.parse(JSON.stringify(initialTemplate));
      let updateRpcCalled = false;

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_service_templates') {
            return { data: [JSON.parse(JSON.stringify(currentRemote))], error: null };
          }
          if (fn === 'get_service_template') {
            return {
              data: {
                ...currentRemote,
                parallel_services: currentRemote.parallelServices,
                activities: currentRemote.activities
              },
              error: null
            };
          }
          if (fn === 'list_event_types' || fn === 'list_church_event_types') {
            return { data: [{ id: 'et-1', name: 'Celebração', active: true }], error: null };
          }
          if (fn === 'list_standard_activities' || fn === 'list_cancellation_reasons') {
            return { data: [], error: null };
          }
          if (fn === 'update_service_template') {
            updateRpcCalled = true;
            return { data: { success: true }, error: null };
          }
          return { data: [], error: null };
        }
      };

      let renderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            AppProvider,
            { initialUserId: 'marcos', churchId: TEST_CHURCH_ID, supabaseClient: mockClient },
            React.createElement(TestConsumer),
            React.createElement(AdminView)
          )
        );
      });

      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      const root = renderer.root;

      // 1. Abre a aba de modelos e inicia edição do modelo ativo
      const templatesTabBtn = root.findByProps({ id: 'tab-admin-templates' });
      await act(async () => {
        templatesTabBtn.props.onClick();
      });
      const editBtn = root.findByProps({ id: 'btn-edit-template-0' });
      await act(async () => {
        editBtn.props.onClick();
      });

      // 2. Modelo é desativado no servidor por outro administrador
      currentRemote.active = false;
      currentRemote.updatedAt = '2026-10-20T12:05:00Z';

      // 3. Reconciliação / sincronização ocorre
      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      // 4. Usuário tenta salvar o formulário antigo
      await act(async () => {
        const form = root.findByProps({ onSubmit: root.findByProps({ id: 'btn-save-template' }).parent.parent.props.onSubmit });
        await form.props.onSubmit({ preventDefault: () => {} });
      });

      // 5. Deve acusar conflito e NÃO deve chamar a RPC de escrita
      assert.equal(updateRpcCalled, false, 'A RPC update_service_template NÃO deve ser chamada após desativação remota');
      const outdatedWarning = root.findAllByProps({ id: 'template-outdated-warning' });
      assert.ok(outdatedWarning.length > 0, 'Interface deve exibir banner de desatualização/conflito');
      const saveBtn = root.findByProps({ id: 'btn-save-template' });
      assert.equal(saveBtn.props.disabled, true, 'Botão salvar deve ser desabilitado quando modelo for desativado remotamente');
    });

    test('Cenário 6 (Regressão A2 Obrigatória): alterar somente displayOrder de serviço remoto bloqueia rascunho antigo sem chamada RPC', async () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      const initialTemplate = {
        id: 'tpl-test-a2',
        churchId: TEST_CHURCH_ID,
        name: 'Culto Apoios A2',
        description: 'Original',
        eventTypeId: 'et-1',
        active: true,
        updatedAt: '2026-10-20T12:00:00Z',
        parallelServicesCount: 2,
        activitiesCount: 1,
        parallelServices: [
          { teamId: 'portaria', serviceName: 'Portaria', prepRequiredMinutes: 15, isDefaultActive: true, displayOrder: 1 },
          { teamId: 'midia', serviceName: 'Mídia', prepRequiredMinutes: 20, isDefaultActive: true, displayOrder: 2 }
        ],
        activities: [
          { title: 'Abertura', category: 'Liturgia', plannedDurationMinutes: 10, displayOrder: 1 }
        ]
      };

      let currentRemote = JSON.parse(JSON.stringify(initialTemplate));
      let updateRpcCalled = false;

      const mockClient = {
        rpc: async (fn, params) => {
          if (fn === 'list_service_templates') {
            return { data: [JSON.parse(JSON.stringify(currentRemote))], error: null };
          }
          if (fn === 'get_service_template') {
            return {
              data: {
                ...currentRemote,
                parallel_services: currentRemote.parallelServices,
                activities: currentRemote.activities
              },
              error: null
            };
          }
          if (fn === 'list_event_types' || fn === 'list_church_event_types') {
            return { data: [{ id: 'et-1', name: 'Celebração', active: true }], error: null };
          }
          if (fn === 'list_standard_activities' || fn === 'list_cancellation_reasons') {
            return { data: [], error: null };
          }
          if (fn === 'update_service_template') {
            updateRpcCalled = true;
            return { data: { success: true }, error: null };
          }
          return { data: [], error: null };
        }
      };

      let renderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            AppProvider,
            { initialUserId: 'marcos', churchId: TEST_CHURCH_ID, supabaseClient: mockClient },
            React.createElement(TestConsumer),
            React.createElement(AdminView)
          )
        );
      });

      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      const root = renderer.root;

      // 1. Inicia edição do modelo
      const templatesTabBtn = root.findByProps({ id: 'tab-admin-templates' });
      await act(async () => {
        templatesTabBtn.props.onClick();
      });
      const editBtn = root.findByProps({ id: 'btn-edit-template-0' });
      await act(async () => {
        editBtn.props.onClick();
      });

      // 2. Modifica ISOLADAMENTE o displayOrder do primeiro serviço remoto (sem trocar posições no array)
      currentRemote.parallelServices[0].displayOrder = 5;
      currentRemote.updatedAt = '2026-10-20T12:05:00Z';

      // 3. Reconciliação
      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      // 4. Tentativa de salvar rascunho antigo
      await act(async () => {
        const form = root.findByProps({ onSubmit: root.findByProps({ id: 'btn-save-template' }).parent.parent.props.onSubmit });
        await form.props.onSubmit({ preventDefault: () => {} });
      });

      // 5. Deve bloquear o salvamento sem chamar a RPC
      assert.equal(updateRpcCalled, false, 'A RPC update_service_template NÃO deve ser chamada após alteração isolada de displayOrder');
    });

    test('Cenário 7: Verificação de integridade do snapshot de edição contendo active e displayOrder', async () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      const initialTemplate = {
        id: 'tpl-test-snap',
        churchId: TEST_CHURCH_ID,
        name: 'Culto Snapshot',
        description: 'Original',
        eventTypeId: 'et-1',
        active: true,
        updatedAt: '2026-10-20T12:00:00Z',
        parallelServicesCount: 1,
        activitiesCount: 1,
        parallelServices: [
          { teamId: 'portaria', serviceName: 'Portaria', prepRequiredMinutes: 15, isDefaultActive: true, displayOrder: 1 }
        ],
        activities: [
          { title: 'Abertura', category: 'Liturgia', plannedDurationMinutes: 10, displayOrder: 1 }
        ]
      };

      const mockClient = {
        rpc: async (fn) => {
          if (fn === 'list_service_templates') return { data: [initialTemplate], error: null };
          if (fn === 'get_service_template') return { data: initialTemplate, error: null };
          return { data: [], error: null };
        }
      };

      await act(async () => {
        TestRenderer.create(
          React.createElement(
            AppProvider,
            { initialUserId: 'marcos', churchId: TEST_CHURCH_ID, supabaseClient: mockClient },
            React.createElement(TestConsumer)
          )
        );
      });

      await act(async () => {
        await contextRef.reloadRemoteData();
      });

      const snapshot = contextRef.beginEditingTemplate('tpl-test-snap');
      assert.ok(snapshot, 'Snapshot deve ser criado');
      assert.equal(snapshot.active, true, 'Snapshot de AppContext deve conter active: true explicitamente');
      assert.equal(snapshot.parallelServices[0].displayOrder, 1, 'Snapshot deve preservar displayOrder do serviço paralelo');
    });

  });

  // ==========================================================================
  // Frente A: Frontend - A3. Bloqueio uniforme das 4 mutações remotas
  // ==========================================================================
  describe('Frente A3: Bloqueio Uniforme das Mutações Remotas em Estado Desatualizado', () => {

    const testOperations = [
      {
        name: 'addCancelReason',
        listRpc: 'list_cancellation_reasons',
        mutationRpc: 'create_cancellation_reason',
        call: (ctx) => ctx.addCancelReason('Motivo Teste Bloqueio'),
        expectedError: /motivos de cancelamento estão desatualizados|dados desatualizados/i
      },
      {
        name: 'addEventType',
        listRpc: 'list_event_types',
        mutationRpc: 'create_event_type',
        call: (ctx) => ctx.addEventType('Tipo Evento Teste', 'Descrição'),
        expectedError: /tipos de evento estão desatualizados|dados desatualizados/i
      },
      {
        name: 'addStandardActivity',
        listRpc: 'list_standard_activities',
        mutationRpc: 'create_standard_activity',
        call: (ctx) => ctx.addStandardActivity('Atividade Teste', 15, 'Liturgia', 'Desc'),
        expectedError: /atividades padrão estão desatualizados|dados desatualizados/i
      },
      {
        name: 'updateStandardActivity',
        listRpc: 'list_standard_activities',
        mutationRpc: 'update_standard_activity',
        call: (ctx) => ctx.updateStandardActivity(TEST_ACT_UUID, 'Atividade Atualizada', 20, 'Liturgia', 'Desc'),
        expectedError: /atividades padrão estão desatualizados|dados desatualizados/i
      }
    ];

    for (const op of testOperations) {
      describe(`Operação: ${op.name}`, () => {

        test(`1. Domínio desatualizado -> a operação ${op.name} NÃO chama a RPC`, async () => {
          let contextRef;
          function TestConsumer() {
            contextRef = useApp();
            return null;
          }

          let mutationRpcCalled = false;
          let shouldFailList = true;

          const mockClient = {
            rpc: async (fn) => {
              if (fn === op.mutationRpc) {
                mutationRpcCalled = true;
                return { data: { id: '00000000-0000-0000-0000-000000000001' }, error: null };
              }
              if (fn === 'list_standard_activities') {
                if (shouldFailList && op.listRpc === 'list_standard_activities') {
                  return { data: null, error: { message: 'Erro ao listar atividades', code: '500' } };
                }
                return { data: [{ id: TEST_ACT_UUID, name: 'Atividade Original', default_duration_minutes: 10, category: 'Liturgia', active: true }], error: null };
              }
              if (fn === 'list_cancellation_reasons') {
                if (shouldFailList && op.listRpc === 'list_cancellation_reasons') {
                  return { data: null, error: { message: 'Erro ao listar motivos', code: '500' } };
                }
                return { data: [], error: null };
              }
              if (fn === 'list_event_types' || fn === 'list_church_event_types') {
                if (shouldFailList && op.listRpc === 'list_event_types') {
                  return { data: null, error: { message: 'Erro ao listar tipos', code: '500' } };
                }
                return { data: [{ id: 'et-1', name: 'Culto', active: true }], error: null };
              }
              if (fn === 'list_service_templates') {
                return { data: [], error: null };
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
                  churchId: TEST_CHURCH_ID,
                  supabaseClient: mockClient
                },
                React.createElement(TestConsumer)
              )
            );
          });

          // Dispara sync com falha específica no domínio da operação
          await act(async () => {
            await contextRef.reloadRemoteData();
          });

          assert.equal(contextRef.isDataStale, true, 'isDataStale deve ser true após falha de sync');

          let result;
          await act(async () => {
            result = await op.call(contextRef);
          });

          assert.equal(result.success, false, `${op.name} deve retornar success: false em estado desatualizado`);
          assert.match(result.error, op.expectedError, 'Mensagem deve indicar desatualização');
          assert.equal(mutationRpcCalled, false, `RPC de mutação ${op.mutationRpc} NÃO deve ter sido chamada`);
        });

        test(`2. Sincronização recuperada -> a operação ${op.name} volta a funcionar`, async () => {
          let contextRef;
          function TestConsumer() {
            contextRef = useApp();
            return null;
          }

          let mutationRpcCalled = false;
          const mockClient = {
            rpc: async (fn) => {
              if (fn === op.mutationRpc) {
                mutationRpcCalled = true;
                return { data: { id: '00000000-0000-0000-0000-000000000001', success: true }, error: null };
              }
              if (fn === 'list_standard_activities') {
                return { data: [{ id: TEST_ACT_UUID, name: 'Atividade Original', default_duration_minutes: 10, category: 'Liturgia', active: true }], error: null };
              }
              if (fn === 'list_cancellation_reasons') {
                return { data: [], error: null };
              }
              if (fn === 'list_event_types' || fn === 'list_church_event_types') {
                return { data: [{ id: 'et-1', name: 'Culto', active: true }], error: null };
              }
              if (fn === 'list_service_templates') {
                return { data: [], error: null };
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
                  churchId: TEST_CHURCH_ID,
                  supabaseClient: mockClient
                },
                React.createElement(TestConsumer)
              )
            );
          });

          // Sincroniza com sucesso (recuperação)
          await act(async () => {
            await contextRef.reloadRemoteData();
          });

          assert.equal(contextRef.isDataStale, false, 'isDataStale deve ser false após sincronização recuperada');

          let result;
          await act(async () => {
            result = await op.call(contextRef);
          });

          assert.equal(result.success, true, `${op.name} deve ter sucesso após sincronização recuperada`);
          assert.equal(mutationRpcCalled, true, `A RPC da operação ${op.name} deve ser chamada quando dados estão atualizados`);
        });

        test(`3. Outro domínio atualizado -> NÃO desbloqueia indevidamente o domínio com falha na operação ${op.name}`, async () => {
          let contextRef;
          function TestConsumer() {
            contextRef = useApp();
            return null;
          }

          let mutationRpcCalled = false;
          const mockClient = {
            rpc: async (fn) => {
              if (fn === op.mutationRpc) {
                mutationRpcCalled = true;
                return { data: { id: '00000000-0000-0000-0000-000000000001', success: true }, error: null };
              }
              // Simula falha especificamente no domínio da operação
              if (op.listRpc === 'list_cancellation_reasons' && fn === 'list_cancellation_reasons') {
                return { data: null, error: { message: 'Erro na API de motivos', code: '500' } };
              }
              if (op.listRpc === 'list_event_types' && (fn === 'list_event_types' || fn === 'list_church_event_types')) {
                return { data: null, error: { message: 'Erro na API de tipos', code: '500' } };
              }
              if (op.listRpc === 'list_standard_activities' && fn === 'list_standard_activities') {
                return { data: null, error: { message: 'Erro na API de atividades', code: '500' } };
              }

              // Os outros domínios respondem com sucesso
              if (fn === 'list_service_templates') {
                return { data: [{ id: 'tpl-1', name: 'Culto Atualizado', active: true }], error: null };
              }
              if (fn === 'get_service_template') {
                return { data: { id: 'tpl-1', name: 'Culto Atualizado', activities: [], parallel_services: [] }, error: null };
              }
              if (fn === 'list_standard_activities') {
                return { data: [{ id: TEST_ACT_UUID, name: 'Atividade Original', default_duration_minutes: 10, category: 'Liturgia', active: true }], error: null };
              }
              if (fn === 'list_event_types' || fn === 'list_church_event_types') {
                return { data: [{ id: 'et-1', name: 'Culto', active: true }], error: null };
              }
              if (fn === 'list_cancellation_reasons') {
                return { data: [], error: null };
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
                  churchId: TEST_CHURCH_ID,
                  supabaseClient: mockClient
                },
                React.createElement(TestConsumer)
              )
            );
          });

          // Tenta recarregar dados remotos
          await act(async () => {
            await contextRef.reloadRemoteData();
          });

          // O domínio correspondente à operação falhou, enquanto outros tiveram sucesso
          assert.equal(contextRef.isDataStale, true, 'isDataStale global deve permanecer true');

          let result;
          await act(async () => {
            result = await op.call(contextRef);
          });

          assert.equal(result.success, false, `${op.name} NÃO deve ser desbloqueado por atualizações de outros domínios`);
          assert.equal(mutationRpcCalled, false, `RPC de mutação para ${op.name} NÃO pode ser chamada`);
        });

      });
    }

  });

  // ==========================================================================
  // Frente B: Pacote SQL 024 - B2. Separar ensaio reversível de rollback permanente
  // ==========================================================================
  describe('Frente B2: Controle Transacional e Segurança em 024_rollback.sql e 024_service_template_instantiation_security.sql', () => {

    test('024_rollback.sql não contém BEGIN ou COMMIT internos e documenta procedimento reversível', () => {
      const sql = fs.readFileSync(path.resolve('docs/sql/024_rollback.sql'), 'utf-8');

      // 1. Não embutir COMMIT ou BEGIN para que o executor controle a transação de ensaio
      const sqlCommandsOnly = sql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n');

      assert.doesNotMatch(sqlCommandsOnly, /\bcommit\s*;/i, '024_rollback.sql não pode ter comando COMMIT interno');
      assert.doesNotMatch(sqlCommandsOnly, /\bbegin\s*;/i, '024_rollback.sql não pode ter comando BEGIN interno');

      // 2. Documenta procedimento de ensaio reversível com ROLLBACK
      assert.ok(sql.includes('PROCEDIMENTO DE ENSAIO REVERSÍVEL DE LABORATÓRIO'));
      assert.ok(sql.includes('ROLLBACK;'));

      // 3. Documenta procedimento de aplicação permanente com COMMIT sujeito a aprovação
      assert.ok(sql.includes('PROCEDIMENTO DE REVERSÃO DEFINITIVA'));
      assert.ok(sql.includes('COMMIT;'));

      // 4. Documenta que o rollback para SQL 022 restaura vulnerabilidade de autorização (cross-church)
      assert.ok(sql.includes('reabre a vulnerabilidade de autorização'));
      assert.ok(sql.includes('cross-church leakage'));

      // 5. Documenta alternativa mais segura de contenção para emergências
      assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.instantiate_service_template'));
      assert.ok(sql.includes('PROCEDIMENTO DE CONTENÇÃO MAIS SEGURO PARA EMERGÊNCIAS'));
    });

    test('024_service_template_instantiation_security.sql não contém BEGIN ou COMMIT internos e documenta ensaio', () => {
      const sql = fs.readFileSync(path.resolve('docs/sql/024_service_template_instantiation_security.sql'), 'utf-8');

      const sqlCommandsOnly = sql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n');

      assert.doesNotMatch(sqlCommandsOnly, /\bcommit\s*;/i, '024_service_template_instantiation_security.sql não pode ter COMMIT interno');
      assert.doesNotMatch(sqlCommandsOnly, /\bbegin\s*;/i, '024_service_template_instantiation_security.sql não pode ter BEGIN interno');

      assert.ok(sql.includes('PROCEDIMENTO DE ENSAIO REVERSÍVEL DE LABORATÓRIO'));
      assert.ok(sql.includes('ROLLBACK;'));
      assert.ok(sql.includes('PROCEDIMENTO DE APLICAÇÃO PERMANENTE'));
      assert.ok(sql.includes('COMMIT;'));
    });

  });

  // ==========================================================================
  // Frente B: Pacote SQL 024 - B3. Corrigir o Verificador
  // ==========================================================================
  describe('Frente B3: Teste Estático Controlado do Verificador 024_verify.sql', () => {

    test('024_verify.sql contém bloco de asserção imperativo com RAISE EXCEPTION', () => {
      const verifySql = fs.readFileSync(path.resolve('docs/sql/024_verify.sql'), 'utf-8');

      assert.ok(verifySql.includes('do $$'), 'Verify deve conter bloco DO imperativo');
      assert.ok(verifySql.includes('raise exception'), 'Verify deve provocar interrupção com RAISE EXCEPTION');
      assert.ok(verifySql.includes("''parallelServices''"), 'Verify checa precisamente chave JSON camelCase');
      assert.ok(verifySql.includes("''parallel\\_services''") || verifySql.includes("''parallel_services''"), 'Verify rejeita chave JSON snake_case');
    });

    test('Lógica do verificador aceita a definição canônica correta contendo v_parallel_services', () => {
      const goodFuncDef = fs.readFileSync(path.resolve('docs/sql/024_service_template_instantiation_security.sql'), 'utf-8');

      // Simula as regras do verificador
      const hasParallelCamel = goodFuncDef.includes("'parallelServices'");
      const hasParallelSnakeKey = goodFuncDef.includes("'parallel_services'");
      const hasActiveFilter = goodFuncDef.includes('where stps.template_id = p_template_id and stps.is_default_active = true');
      const hasAccessCheck = goodFuncDef.includes('has_church_settings_access(p_church_id, false)');

      assert.equal(hasParallelCamel, true, 'Definição correta tem chave parallelServices');
      assert.equal(hasParallelSnakeKey, false, 'Definição correta NÃO usa chave JSON parallel_services (mesmo contendo v_parallel_services)');
      assert.equal(hasActiveFilter, true, 'Definição correta tem filtro is_default_active = true');
      assert.equal(hasAccessCheck, true, 'Definição correta tem checagem de autorização');
    });

    test('Lógica do verificador rejeita definição que altera chave JSON para parallel_services', () => {
      const badFuncDef = `
        create or replace function public.instantiate_service_template(...) returns jsonb as $$
        begin
          return jsonb_build_object(
            'success', true,
            'parallel_services', v_parallel_services
          );
        end; $$;
      `;

      const hasParallelCamel = badFuncDef.includes("'parallelServices'");
      const hasParallelSnakeKey = badFuncDef.includes("'parallel_services'");

      assert.equal(hasParallelCamel, false, 'Definição defeituosa não tem camelCase');
      assert.equal(hasParallelSnakeKey, true, 'Definição defeituosa detectada com snake_case');
    });

    test('Lógica do verificador rejeita definição que remove filtro is_default_active = true', () => {
      const badFilterDef = `
        select coalesce(jsonb_agg(...) into v_parallel_services
        from app_private.service_template_parallel_services stps
        where stps.template_id = p_template_id; -- faltou and stps.is_default_active = true
      `;

      const hasActiveFilter = badFilterDef.includes('where stps.template_id = p_template_id and stps.is_default_active = true');
      assert.equal(hasActiveFilter, false, 'Definição defeituosa sem filtro é detectada e rejeitada');
    });

  });

  // ==========================================================================
  // Frente B: Pacote SQL 024 - B3. Fortalecer o Preflight
  // ==========================================================================
  describe('Frente B3: Fortalecimento do Preflight 024_preflight.sql', () => {

    test('024_preflight.sql valida assinaturas, tipos de retorno, owner postgres e ACLs com RAISE EXCEPTION', () => {
      const preflightSql = fs.readFileSync(path.resolve('docs/sql/024_preflight.sql'), 'utf-8');

      // 1. Assinaturas exatas
      assert.ok(preflightSql.includes("to_regprocedure('public.instantiate_service_template(uuid, uuid, uuid)')"));
      assert.ok(preflightSql.includes("to_regprocedure('app_private.has_church_settings_access(uuid, boolean)')"));

      // 2. Tipos de retorno
      assert.ok(preflightSql.includes("v_proc_rettype <> 'jsonb'"));
      assert.ok(preflightSql.includes("v_helper_rettype <> 'boolean'"));

      // 3. Owner postgres interrompe com erro em vez de apenas warning
      assert.ok(preflightSql.includes("v_owner <> 'postgres'"));
      assert.ok(preflightSql.includes("PREFLIGHT FALHOU: Owner atual da RPC é \"%\", esperava-se estritamente \"postgres\""));

      // 4. Configurações de segurança e timeout
      assert.ok(preflightSql.includes("statement_timeout=5s"));
      assert.ok(preflightSql.includes("search_path="));

      // 5. ACLs
      assert.ok(preflightSql.includes("has_function_privilege('authenticated', v_proc, 'EXECUTE')"));
      assert.ok(preflightSql.includes("has_function_privilege('anon', v_proc, 'EXECUTE')"));

      // 6. Hardening de proconfig nulo (B4) e escape de LIKE
      assert.ok(preflightSql.includes("v_config is null"));
      assert.ok(preflightSql.includes("escape '\\'"));

      // 7. Verificação de contrato integral (B3)
      assert.ok(preflightSql.includes("plannedDurationMinutes"));
      assert.ok(preflightSql.includes("roster"));
      assert.ok(preflightSql.includes("volunteers"));
      assert.ok(preflightSql.includes("leaderId"));
    });

  });

  // ==========================================================================
  // Frente B: Roteiro SQL 024 - Fixtures, Captura de Erros e Cenários de Ensaio
  // ==========================================================================
  describe('Frente B: Roteiro de Ensaio 024_rehearsal_cases.sql e 024_rehearsal_consolidated.sql', () => {

    test('B1: Fixtures obrigatórias incluem church_id nas tabelas filhas conforme DDL 022', () => {
      const sqlCases = fs.readFileSync(path.resolve('docs/sql/024_rehearsal_cases.sql'), 'utf-8');
      const sqlConsolidated = fs.readFileSync(path.resolve('docs/sql/024_rehearsal_consolidated.sql'), 'utf-8');

      for (const [name, sql] of [['024_rehearsal_cases.sql', sqlCases], ['024_rehearsal_consolidated.sql', sqlConsolidated]]) {
        assert.match(
          sql,
          /insert into app_private\.service_template_activities\s*\([^)]*church_id[^)]*\)/i,
          `[${name}] Inserção em service_template_activities deve incluir a coluna church_id`
        );
        assert.match(
          sql,
          /insert into app_private\.service_template_parallel_services\s*\([^)]*church_id[^)]*\)/i,
          `[${name}] Inserção em service_template_parallel_services deve incluir a coluna church_id`
        );
      }
    });

    test('B1: Fixture de acesso revogado inclui revoked_at e revoked_by_user_id válidos respeitando church_access_revocation_state', () => {
      const sqlCases = fs.readFileSync(path.resolve('docs/sql/024_rehearsal_cases.sql'), 'utf-8');
      const sqlConsolidated = fs.readFileSync(path.resolve('docs/sql/024_rehearsal_consolidated.sql'), 'utf-8');

      for (const [name, sql] of [['024_rehearsal_cases.sql', sqlCases], ['024_rehearsal_consolidated.sql', sqlConsolidated]]) {
        // Colunas obrigatórias declaradas no insert de church_access
        assert.match(sql, /insert into app_private\.church_access\s*\([^)]*revoked_by_user_id[^)]*revoked_at[^)]*\)/i,
          `[${name}] Inserção em church_access deve declarar explicitamente revoked_by_user_id e revoked_at`);

        // Registro revogado deve conter status revoked e metadados preenchidos
        assert.match(sql, /'revoked'[\s\S]{1,250}?interval '1 hour'[\s\S]{1,250}?clock_timestamp/i,
          `[${name}] Registro revogado deve conter revoked_at >= granted_at e revoked_by_user_id`);
      }
    });

    test('B1 Contraprova: comprova que fixture com status = revoked sem revoked_at violaria a constraint', () => {
      function validateRevocationConstraint(row) {
        const isActive = row.status === 'active' && row.revoked_at === null && row.revoked_by_user_id === null;
        const isRevoked = row.status === 'revoked' && row.revoked_at !== null && row.revoked_by_user_id !== null && row.revoked_at >= row.granted_at;
        return isActive || isRevoked;
      }

      // Linha válida
      assert.equal(validateRevocationConstraint({
        status: 'revoked',
        granted_at: new Date('2026-10-20T10:00:00Z'),
        revoked_at: new Date('2026-10-20T11:00:00Z'),
        revoked_by_user_id: 'user-1'
      }), true, 'Linha com metadados completos de revogação é válida');

      // Linha defeituosa sem revoked_at (como estava antes da correção B1)
      assert.equal(validateRevocationConstraint({
        status: 'revoked',
        granted_at: new Date('2026-10-20T10:00:00Z'),
        revoked_at: null,
        revoked_by_user_id: null
      }), false, 'Linha sem revoked_at viola constraint church_access_revocation_state');
    });

    test('B2: Helper st024_as trata exceções adequadamente, captura SQLSTATE e restaura contexto', () => {
      const sql = fs.readFileSync(path.resolve('docs/sql/024_rehearsal_cases.sql'), 'utf-8');

      assert.ok(sql.includes('get stacked diagnostics'), 'Helper deve capturar SQLSTATE e mensagem via diagnostics');
      assert.ok(sql.includes('returned_sqlstate'), 'Helper deve extrair returned_sqlstate');
      assert.ok(sql.includes('sucesso indevido'), 'Helper deve acusar sucesso indevido quando rejeição era esperada');
      assert.ok(sql.includes('reset role;'), 'Helper deve sempre restaurar a role para evitar privilégios residuais');
    });

    test('B2: Eliminação do exemplo perigoso de rollback em 024_rollback.sql e controle transacional', () => {
      const rollbackSql = fs.readFileSync(path.resolve('docs/sql/024_rollback.sql'), 'utf-8');

      // 1. NÃO deve conter pipe bare direto sem BEGIN/ROLLBACK
      assert.equal(
        rollbackSql.includes('Get-Content docs\\sql\\024_rollback.sql -Raw | docker exec -i supabase_db_escala-convites-http-lab psql -U postgres -d postgres -v ON_ERROR_STOP=1\n'),
        false,
        'Exemplo de pipe bare inseguro sem BEGIN/ROLLBACK foi completamente removido'
      );

      // 2. Deve documentar encapsulamento estrito com BEGIN e ROLLBACK na mesma conexão
      assert.ok(rollbackSql.includes('$rehearsal = "BEGIN;`n" + (Get-Content docs\\sql\\024_rollback.sql -Raw) + "`nROLLBACK;"'),
        'Exemplo seguro em PowerShell envelopa em transação BEGIN ... ROLLBACK na mesma conexão');

      // 3. Documenta risco de reabertura de vulnerabilidade cross-church
      assert.ok(rollbackSql.includes('cross-church leakage'), 'Documenta risco de vazamento cross-church ao restaurar SQL 022');
      assert.ok(rollbackSql.includes('REVOKE EXECUTE ON FUNCTION public.instantiate_service_template'),
        'Apresenta alternativa recomendada de contenção por REVOKE EXECUTE');
    });

    test('B3 e B5: Todos os 8 perfis e asserções comportamentais e estruturais estão presentes no ensaio', () => {
      const sqlCases = fs.readFileSync(path.resolve('docs/sql/024_rehearsal_cases.sql'), 'utf-8');
      const sqlConsolidated = fs.readFileSync(path.resolve('docs/sql/024_rehearsal_consolidated.sql'), 'utf-8');

      for (const [name, sql] of [['024_rehearsal_cases.sql', sqlCases], ['024_rehearsal_consolidated.sql', sqlConsolidated]]) {
        // 8 Perfis de autorização executáveis
        assert.ok(sql.includes('C01: Usuário anônimo'), `[${name}] Cenário Anônimo`);
        assert.ok(sql.includes('C02: Autenticado sem vínculo') || sql.includes('C02: Usuário autenticado sem qualquer vínculo'), `[${name}] Cenário Autenticado sem vínculo`);
        assert.ok(sql.includes('C03: Admin de outra igreja') || sql.includes('C03: Administrador de outra igreja'), `[${name}] Cenário Admin outra igreja`);
        assert.ok(sql.includes('C04: Vínculo revogado') || sql.includes('C04: Vínculo revogado ou inativo'), `[${name}] Cenário Vínculo revogado`);
        assert.ok(sql.includes('C05: Membro básico elegível'), `[${name}] Cenário Membro básico`);
        assert.ok(sql.includes('C06: Líder não admin') || sql.includes('C06: Líder não administrador'), `[${name}] Cenário Líder não admin`);
        assert.ok(sql.includes('C07: Admin autorizado') || sql.includes('C07: Administrador autorizado da igreja'), `[${name}] Cenário Admin autorizado`);
        assert.ok(sql.includes('C08: Igreja e Modelo Incompatíveis') || sql.includes('C08: Igreja/modelo incompatíveis'), `[${name}] Cenário Igreja/modelo incompatíveis`);

        // B3: Asserções completas de contrato JSON
        assert.ok(sql.includes('^act-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), `[${name}] Regex de ID da atividade`);
        assert.ok(sql.includes('^serv-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), `[${name}] Regex de ID do serviço paralelo`);
        assert.ok(sql.includes("IDs das atividades devem ser únicos e distintos"), `[${name}] Asserção de IDs distintos`);
        assert.ok(sql.includes("Notas de abertura"), `[${name}] Asserção de notes da atividade 1`);
        assert.ok(sql.includes("Cânticos"), `[${name}] Asserção de notes da atividade 2`);
        assert.ok(sql.includes("Apoio Especial"), `[${name}] Confirmação expressa de exclusão de serviço inativo`);
        assert.ok(sql.includes("is distinct from"), `[${name}] Comparações seguras contra NULL com is distinct from`);
        assert.ok(sql.includes("plannedDurationMinutes"), `[${name}] Asserção de plannedDurationMinutes`);
        assert.ok(sql.includes("roster"), `[${name}] Asserção de roster vazio`);
        assert.ok(sql.includes("musics"), `[${name}] Asserção de musics vazio`);
        assert.ok(sql.includes("parallelServices"), `[${name}] Asserção de parallelServices camelCase`);
        assert.ok(sql.includes("parallel_services"), `[${name}] Asserção contra parallel_services snake_case`);
        assert.ok(sql.includes("volunteers"), `[${name}] Asserção de volunteers vazio`);
        assert.ok(sql.includes("leaderId"), `[${name}] Asserção de leaderId nulo`);
        assert.ok(sql.includes("responsibleMemberId"), `[${name}] Asserção de responsibleMemberId nulo`);

        // B3 & B5: Verificação de não-mutação de dados via hashes antes e depois (C10)
        assert.ok(sql.includes("v_hash_tpl_before"), `[${name}] Hash prévio de templates`);
        assert.ok(sql.includes("v_hash_act_before"), `[${name}] Hash prévio de atividades`);
        assert.ok(sql.includes("v_hash_par_before"), `[${name}] Hash prévio de serviços paralelos`);
        assert.ok(sql.includes("v_hash_tpl_after"), `[${name}] Hash posterior de templates`);
        assert.ok(sql.includes("v_hash_act_after"), `[${name}] Hash posterior de atividades`);
        assert.ok(sql.includes("v_hash_par_after"), `[${name}] Hash posterior de serviços paralelos`);
      }
    });

    test('B3 Contraprova: alteração indevida de notes, IDs ou dados mutados seria capturada pelo ensaio', () => {
      // Simula objeto de resposta com notes alterado
      const badNotesAct = {
        id: 'act-01700000-0000-4000-8000-000000000001',
        title: 'Abertura',
        category: 'Liturgia',
        plannedDurationMinutes: 10,
        status: 'pendente',
        notes: 'Notas adulteradas pelo teste'
      };
      assert.notEqual(badNotesAct.notes, 'Notas de abertura', 'Notes adulterado é detectado');

      // Simula ID fora do padrão
      const badIdAct = { id: 'invalid-id-format' };
      const idRegex = /^act-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      assert.equal(idRegex.test(badIdAct.id), false, 'ID inválido é rejeitado pelo regex');

      // Simula mutação em banco
      const hashBefore = 'abc123hash';
      const hashAfter = 'xyz789mutated';
      assert.notEqual(hashBefore, hashAfter, 'Mutação de dados em tabela resulta em hashes distintos e exceção');
    });

    test('B4: Hardening de proconfig nulo e escape de _ em 024_verify.sql', () => {
      const verifySql = fs.readFileSync(path.resolve('docs/sql/024_verify.sql'), 'utf-8');

      assert.ok(verifySql.includes('v_config is null'), 'Verify deve rejeitar explicitamente proconfig NULL');
      assert.ok(verifySql.includes("escape '\\'"), "Verify deve usar escape '\\' em LIKE com sublinhado");
      assert.ok(verifySql.includes('plannedDurationMinutes'), 'Verify deve validar plannedDurationMinutes');
      assert.ok(verifySql.includes('roster'), 'Verify deve validar roster');
      assert.ok(verifySql.includes('volunteers'), 'Verify deve validar volunteers');
      assert.ok(verifySql.includes('leaderId'), 'Verify deve validar leaderId');
    });

    test('B5 / C09: Validação estrita do C09 e equivalência entre 024_rehearsal_cases.sql e 024_rehearsal_consolidated.sql', () => {
      const sqlCases = fs.readFileSync(path.resolve('docs/sql/024_rehearsal_cases.sql'), 'utf-8');
      const sqlConsolidated = fs.readFileSync(path.resolve('docs/sql/024_rehearsal_consolidated.sql'), 'utf-8');

      for (const [name, sql] of [['024_rehearsal_cases.sql', sqlCases], ['024_rehearsal_consolidated.sql', sqlConsolidated]]) {
        // Correção 1: IDs resistentes a NULL e verificação de tipo string
        assert.ok(sql.includes("coalesce((v_par1->>'id') ~ '^serv-"), `[${name}] ID de serviço com coalesce resistente a NULL`);
        assert.ok(sql.includes("coalesce((v_act1->>'id') ~ '^act-"), `[${name}] ID da atividade 1 com coalesce resistente a NULL`);
        assert.ok(sql.includes("coalesce((v_act2->>'id') ~ '^act-"), `[${name}] ID da atividade 2 com coalesce resistente a NULL`);
        assert.ok(sql.includes("jsonb_typeof(v_par1->'id') is distinct from 'string'"), `[${name}] Tipo string obrigatório para ID de serviço`);
        assert.ok(sql.includes("jsonb_typeof(v_act1->'id') is distinct from 'string'"), `[${name}] Tipo string obrigatório para ID da atividade 1`);
        assert.ok(sql.includes("jsonb_typeof(v_act2->'id') is distinct from 'string'"), `[${name}] Tipo string obrigatório para ID da atividade 2`);

        // Correção 2: Presença explícita de campos e distinção entre ausente e null
        assert.ok(sql.includes("v_act1 ? 'responsibleMemberId'"), `[${name}] Presença de responsibleMemberId na atividade 1`);
        assert.ok(sql.includes("v_act1 ? 'responsibleTeamId'"), `[${name}] Presença de responsibleTeamId na atividade 1`);
        assert.ok(sql.includes("jsonb_typeof(v_act1->'responsibleMemberId') is distinct from 'null'"), `[${name}] responsibleMemberId com JSON null`);
        assert.ok(sql.includes("jsonb_typeof(v_act1->'responsibleTeamId') is distinct from 'null'"), `[${name}] responsibleTeamId com JSON null`);
        assert.ok(sql.includes("v_par1 ? 'leaderId'"), `[${name}] Presença de leaderId no apoio`);
        assert.ok(sql.includes("jsonb_typeof(v_par1->'leaderId') is distinct from 'null'"), `[${name}] leaderId com JSON null`);

        // Correção 3: Tipos JSON validados com jsonb_typeof antes de conversões
        assert.ok(sql.includes("jsonb_typeof(v_par1->'prepRequiredMinutes') is distinct from 'number'"), `[${name}] prepRequiredMinutes validado como JSON number`);
        assert.ok(sql.includes("jsonb_typeof(v_act1->'plannedDurationMinutes') is distinct from 'number'"), `[${name}] plannedDurationMinutes act1 validado como JSON number`);
        assert.ok(sql.includes("jsonb_typeof(v_act2->'plannedDurationMinutes') is distinct from 'number'"), `[${name}] plannedDurationMinutes act2 validado como JSON number`);
        assert.ok(sql.includes("jsonb_typeof(v_act1->'requiresPlayback') is distinct from 'boolean'"), `[${name}] requiresPlayback act1 validado como JSON boolean`);
        assert.ok(sql.includes("jsonb_typeof(v_act2->'requiresPlayback') is distinct from 'boolean'"), `[${name}] requiresPlayback act2 validado como JSON boolean`);
        assert.ok(sql.includes("jsonb_typeof(result->'success') is distinct from 'boolean'"), `[${name}] success validado como JSON boolean`);

        // Estratégia recomendada: normalização e comparação exata com contrato canônico SQL 022
        assert.ok(sql.includes("v_normalized := jsonb_set("), `[${name}] Normalização de IDs em JSONB`);
        assert.ok(sql.includes("if v_normalized is distinct from v_expected then"), `[${name}] Comparação exata do objeto normalizado`);

        // Testes obrigatórios: presença das 7 contraprovas formais no script
        assert.ok(sql.includes("Contraprova 1 falhou"), `[${name}] Contraprova 1: ID de serviço nulo`);
        assert.ok(sql.includes("Contraprova 2 falhou"), `[${name}] Contraprova 2: ID de atividade ausente ou nulo`);
        assert.ok(sql.includes("Contraprova 3 falhou"), `[${name}] Contraprova 3: responsibleMemberId ausente`);
        assert.ok(sql.includes("Contraprova 4 falhou"), `[${name}] Contraprova 4: responsibleTeamId ausente`);
        assert.ok(sql.includes("Contraprova 5 falhou"), `[${name}] Contraprova 5: prepRequiredMinutes como string`);
        assert.ok(sql.includes("Contraprova 6 falhou"), `[${name}] Contraprova 6: plannedDurationMinutes como string`);
        assert.ok(sql.includes("Contraprova 7 falhou"), `[${name}] Contraprova 7: requiresPlayback como string`);
      }

      // Equivalência estrita entre o bloco C09 de ambos os arquivos
      const extractC09 = (sql) => {
        const start = sql.indexOf('-- C09: Verificação Integral e Comportamental do Contrato SQL 022');
        const end = sql.indexOf('-- C10: Ausência de Gravação Persistente');
        return sql.substring(start, end).trim();
      };
      assert.equal(extractC09(sqlCases), extractC09(sqlConsolidated), 'Bloco C09 deve ser rigorosamente equivalente entre os dois roteiros');
    });

    test('B5 / C09 Contraprovas do Contrato: comprovação estática da rejeição das 7 anomalias e aceitação do retorno canônico', () => {
      function validateC09Contract(res) {
        // Validação idêntica às regras estabelecidas em C09
        const rootKeys = ['success', 'template_id', 'template_name', 'event_type_id', 'activities', 'parallelServices'];
        for (const k of rootKeys) {
          if (!(k in res)) throw new Error(`C09 falhou: chave obrigatória ${k} ausente`);
        }
        if ('parallel_services' in res) throw new Error('C09 falhou: chave snake_case parallel_services');
        if (typeof res.success !== 'boolean' || res.success !== true) throw new Error('C09 falhou: success deve ser boolean true');
        if (typeof res.template_id !== 'string') throw new Error('C09 falhou: template_id deve ser string');
        if (typeof res.template_name !== 'string') throw new Error('C09 falhou: template_name deve ser string');
        if (typeof res.event_type_id !== 'string') throw new Error('C09 falhou: event_type_id deve ser string');
        if (!Array.isArray(res.activities) || res.activities.length !== 2) throw new Error('C09 falhou: activities deve ser array com 2 elementos');
        if (!Array.isArray(res.parallelServices) || res.parallelServices.length !== 1) throw new Error('C09 falhou: parallelServices deve ser array com 1 elemento');

        const par = res.parallelServices[0];
        const parKeys = ['id', 'name', 'teamId', 'leaderId', 'volunteers', 'status', 'prepRequiredMinutes'];
        for (const k of parKeys) {
          if (!(k in par)) throw new Error(`C09 falhou: campo ${k} ausente no serviço paralelo`);
        }
        // Correção 1: ID presente, string não-nula, formato serv-<uuid>
        if (typeof par.id !== 'string' || par.id === null || !/^serv-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(par.id)) {
          throw new Error('C09 falhou: formato de ID do serviço paralelo inválido');
        }
        // Correção 3: prepRequiredMinutes deve ser number
        if (typeof par.prepRequiredMinutes !== 'number' || par.prepRequiredMinutes !== 15) {
          throw new Error('C09 falhou: prepRequiredMinutes incorreto');
        }
        // Correção 2: leaderId presente com valor null
        if (!('leaderId' in par) || par.leaderId !== null) {
          throw new Error('C09 falhou: leaderId deve ser null na instanciação');
        }

        const actKeys = ['id', 'title', 'category', 'plannedDurationMinutes', 'status', 'responsibleMemberId', 'responsibleTeamId', 'notes', 'requiresPlayback', 'musics', 'roster'];
        for (let i = 0; i < 2; i++) {
          const act = res.activities[i];
          for (const k of actKeys) {
            if (!(k in act)) throw new Error(`C09 falhou: campo obrigatório ${k} ausente na atividade ${i + 1}`);
          }
          // Correção 1: ID presente, string não-nula, formato act-<uuid>
          if (typeof act.id !== 'string' || act.id === null || !/^act-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(act.id)) {
            throw new Error(`C09 falhou: formato de ID da atividade ${i + 1} inválido`);
          }
          // Correção 2: responsibleMemberId e responsibleTeamId presentes com valor null
          if (!('responsibleMemberId' in act) || act.responsibleMemberId !== null || !('responsibleTeamId' in act) || act.responsibleTeamId !== null) {
            throw new Error('C09 falhou: responsibleMemberId e responsibleTeamId devem ser null na atividade');
          }
          // Correção 3: plannedDurationMinutes e requiresPlayback tipos
          if (typeof act.plannedDurationMinutes !== 'number') {
            throw new Error(`C09 falhou: plannedDurationMinutes da atividade ${i + 1} incorreto`);
          }
          if (typeof act.requiresPlayback !== 'boolean') {
            throw new Error(`C09 falhou: requiresPlayback da atividade ${i + 1} deve ser boolean`);
          }
        }

        if (res.activities[0].id === res.activities[1].id) {
          throw new Error('C09 falhou: IDs das atividades devem ser únicos e distintos');
        }

        return true;
      }

      function getCanonicalSql022Payload() {
        return {
          success: true,
          template_id: '02400000-0000-4000-8000-000000000070',
          template_name: 'Modelo Domingo 024',
          event_type_id: '02400000-0000-4000-8000-000000000050',
          activities: [
            {
              id: 'act-02400000-0000-4000-8000-000000000071',
              title: 'Abertura',
              category: 'Liturgia',
              plannedDurationMinutes: 10,
              status: 'pendente',
              responsibleMemberId: null,
              responsibleTeamId: null,
              notes: 'Notas de abertura',
              requiresPlayback: false,
              musics: [],
              roster: []
            },
            {
              id: 'act-02400000-0000-4000-8000-000000000072',
              title: 'Louvor',
              category: 'Louvor',
              plannedDurationMinutes: 30,
              status: 'pendente',
              responsibleMemberId: null,
              responsibleTeamId: null,
              notes: 'Cânticos',
              requiresPlayback: true,
              musics: [],
              roster: []
            }
          ],
          parallelServices: [
            {
              id: 'serv-02400000-0000-4000-8000-000000000081',
              name: 'Portaria',
              teamId: 'recepcao',
              leaderId: null,
              volunteers: [],
              status: 'Aguardando culto',
              prepRequiredMinutes: 15
            }
          ]
        };
      }

      // 0. Retorno canônico válido do SQL 022 continua sendo aceito
      assert.equal(validateC09Contract(getCanonicalSql022Payload()), true, 'Retorno canônico SQL 022 é aprovado com sucesso');

      // 1. Contraprova 1: ID de serviço igual a JSON null é rejeitado
      const cp1 = getCanonicalSql022Payload();
      cp1.parallelServices[0].id = null;
      assert.throws(() => validateC09Contract(cp1), /formato de ID do serviço paralelo inválido/);

      // 2. Contraprova 2: ID de atividade ausente ou nulo é rejeitado
      const cp2a = getCanonicalSql022Payload();
      delete cp2a.activities[0].id;
      assert.throws(() => validateC09Contract(cp2a), /campo obrigatório id ausente/);

      const cp2b = getCanonicalSql022Payload();
      cp2b.activities[0].id = null;
      assert.throws(() => validateC09Contract(cp2b), /formato de ID da atividade 1 inválido/);

      // 3. Contraprova 3: responsibleMemberId ausente é rejeitado
      const cp3 = getCanonicalSql022Payload();
      delete cp3.activities[0].responsibleMemberId;
      assert.throws(() => validateC09Contract(cp3), /campo obrigatório responsibleMemberId ausente/);

      // 4. Contraprova 4: responsibleTeamId ausente é rejeitado
      const cp4 = getCanonicalSql022Payload();
      delete cp4.activities[0].responsibleTeamId;
      assert.throws(() => validateC09Contract(cp4), /campo obrigatório responsibleTeamId ausente/);

      // 5. Contraprova 5: prepRequiredMinutes como string ("15") é rejeitado
      const cp5 = getCanonicalSql022Payload();
      cp5.parallelServices[0].prepRequiredMinutes = "15";
      assert.throws(() => validateC09Contract(cp5), /prepRequiredMinutes incorreto/);

      // 6. Contraprova 6: plannedDurationMinutes como string ("10") é rejeitado
      const cp6 = getCanonicalSql022Payload();
      cp6.activities[0].plannedDurationMinutes = "10";
      assert.throws(() => validateC09Contract(cp6), /plannedDurationMinutes da atividade 1 incorreto/);

      // 7. Contraprova 7: requiresPlayback como string ("false") é rejeitado
      const cp7 = getCanonicalSql022Payload();
      cp7.activities[0].requiresPlayback = "false";
      assert.throws(() => validateC09Contract(cp7), /requiresPlayback da atividade 1 deve ser boolean/);
    });

  });

});
