import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  normalizeNfcText,
  validateServiceTemplate,
  instantiateTemplateForEvent,
  removeParallelServiceFromEvent,
  addParallelServiceToEvent,
  isTemplateUsedInEvents,
  canDeleteServiceTemplate,
  deleteServiceTemplateRemote,
  instantiateServiceTemplateRemote,
  serviceTemplateErrorMessage,
  toServiceTemplateObject,
  toTemplateActivity,
  toTemplateParallelService,
  getActiveTemplates,
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  MAX_DESC_LENGTH,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  MAX_PREP_MINUTES,
} from '../src/utils/serviceTemplateService.js';

// Prepara bundle para teste de componentes React
const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'service-templates-components.bundle.mjs');

await build({
  stdin: {
    contents: `
      export { AppProvider, useApp } from './src/context/AppContext.jsx';
      export { default as AdminView } from './src/components/AdminView.jsx';
      export { default as PlanningView } from './src/components/PlanningView.jsx';
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

const { AppProvider, useApp, AdminView, PlanningView } = await import(
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

function renderWithProvider(ui, userId = 'marcos') {
  let renderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(AppProvider, { initialUserId: userId }, ui)
    );
  });
  return renderer;
}

describe('Issue #27: Preparar modelos reutilizáveis de culto', () => {
  describe('1. Unidades de Serviço: serviceTemplateService', () => {
    test('1.1 Normalização em NFC e sanitização de texto', () => {
      const accented = '  Culto de Celebração Noturna  ';
      const clean = normalizeNfcText(accented);
      assert.equal(clean, 'Culto de Celebração Noturna');
      assert.equal(normalizeNfcText(null), '');
      assert.equal(normalizeNfcText(undefined), '');
    });

    test('1.2 Validação de Modelo de Culto (CA01)', () => {
      const existing = [
        { id: 'st-1', name: 'Culto Padrão', active: true }
      ];

      // Nome obrigatório
      const empty = validateServiceTemplate({ name: '' }, existing);
      assert.equal(empty.valid, false);
      assert.match(empty.error, /obrigatório/i);

      // Limite máximo de 100 caracteres no nome
      const longName = validateServiceTemplate({ name: 'M'.repeat(MAX_NAME_LENGTH + 1) }, existing);
      assert.equal(longName.valid, false);
      assert.match(longName.error, /máximo 100 caracteres/i);

      // Limite máximo de 255 caracteres na descrição
      const longDesc = validateServiceTemplate({ name: 'Culto', description: 'D'.repeat(MAX_DESC_LENGTH + 1) }, existing);
      assert.equal(longDesc.valid, false);
      assert.match(longDesc.error, /máximo 255 caracteres/i);

      // Duplicidade case-insensitive
      const dup = validateServiceTemplate({ name: '  culto padrão  ' }, existing);
      assert.equal(dup.valid, false);
      assert.match(dup.error, /já existe/i);

      // Validação de duração das atividades no modelo (1 a 720 min)
      const invalidAct = validateServiceTemplate({
        name: 'Culto Especial',
        activities: [{ title: 'Louvor', plannedDurationMinutes: 0 }]
      }, existing);
      assert.equal(invalidAct.valid, false);
      assert.match(invalidAct.error, /entre 1 e 720 minutos/i);

      // Validação de tempo de preparação dos apoios (0 a 180 min)
      const invalidPrep = validateServiceTemplate({
        name: 'Culto Especial',
        parallelServices: [{ serviceName: 'Som', prepRequiredMinutes: 200 }]
      }, existing);
      assert.equal(invalidPrep.valid, false);
      assert.match(invalidPrep.error, /entre 0 e 180 minutos/i);

      // Sucesso
      const valid = validateServiceTemplate({
        name: 'Culto Matutino',
        description: 'Culto congregacional da manhã',
        activities: [{ title: 'Abertura', plannedDurationMinutes: 10 }],
        parallelServices: [{ serviceName: 'Portaria', prepRequiredMinutes: 15 }]
      }, existing);
      assert.equal(valid.valid, true);
      assert.equal(valid.error, null);
    });

    test('1.3 CA01: O modelo organiza atividades principais e serviços paralelos (apoios por padrão)', () => {
      const model = toServiceTemplateObject({
        id: 'st-sample',
        name: 'Culto de Celebração',
        activities: [
          { title: 'Boas-Vindas', category: 'Liturgia', plannedDurationMinutes: 5 },
          { title: 'Louvor Congregacional', category: 'Louvor', plannedDurationMinutes: 25 },
          { title: 'Mensagem', category: 'Palavra', plannedDurationMinutes: 40 }
        ],
        parallelServices: [
          { teamId: 'recepcao', serviceName: 'Portaria & Boas-Vindas', prepRequiredMinutes: 15, isDefaultActive: true },
          { teamId: 'som', serviceName: 'Sonoplastia & Retorno', prepRequiredMinutes: 30, isDefaultActive: true },
          { teamId: 'midia', serviceName: 'Transmissão ao Vivo', prepRequiredMinutes: 20, isDefaultActive: true }
        ]
      });

      assert.equal(model.activities.length, 3);
      assert.equal(model.parallelServices.length, 3);
      assert.equal(model.parallelServices[2].serviceName, 'Transmissão ao Vivo');
      assert.equal(model.parallelServices[2].prepRequiredMinutes, 20);
    });

    test('1.4 CA02: Usar o modelo cria edição ajustável; retirar transmissão não altera o modelo nem outros eventos', () => {
      const template = toServiceTemplateObject({
        id: 'st-origin',
        name: 'Culto Geral com Transmissão',
        activities: [
          { title: 'Louvor', plannedDurationMinutes: 20 }
        ],
        parallelServices: [
          { id: 'tps-som', teamId: 'som', serviceName: 'Sonoplastia', prepRequiredMinutes: 20, isDefaultActive: true },
          { id: 'tps-midia', teamId: 'midia', serviceName: 'Transmissão ao Vivo', prepRequiredMinutes: 20, isDefaultActive: true }
        ]
      });

      const eventA = { id: 'evt-1', title: 'Culto Domingo A', activities: [], parallelServices: [] };
      const eventB = { id: 'evt-2', title: 'Culto Domingo B', activities: [], parallelServices: [] };

      // Instanciação no Evento A e no Evento B
      const instantiatedA = instantiateTemplateForEvent(template, eventA);
      const instantiatedB = instantiateTemplateForEvent(template, eventB);

      assert.equal(instantiatedA.parallelServices.length, 2);
      assert.equal(instantiatedB.parallelServices.length, 2);

      // Localiza o serviço de transmissão no Evento A
      const midiaServiceInA = instantiatedA.parallelServices.find(s => s.teamId === 'midia');
      assert.ok(midiaServiceInA);

      // Retira a transmissão do Evento A (ex: decisão pastoral por culto ao ar livre ou pane técnica)
      const adjustedA = removeParallelServiceFromEvent(instantiatedA, midiaServiceInA.id);

      // No Evento A, a transmissão foi removida
      assert.equal(adjustedA.parallelServices.length, 1);
      assert.equal(adjustedA.parallelServices.some(s => s.teamId === 'midia'), false);

      // NO MODELO ORIGINAL, A TRANSMISSÃO PERMANECE INTACTA
      assert.equal(template.parallelServices.length, 2);
      assert.equal(template.parallelServices.some(s => s.teamId === 'midia'), true);

      // NO EVENTO B, A TRANSMISSÃO PERMANECE INTACTA
      assert.equal(instantiatedB.parallelServices.length, 2);
      assert.equal(instantiatedB.parallelServices.some(s => s.teamId === 'midia'), true);
    });

    test('1.5 CA03: O modelo NÃO escala, confirma ou reserva pessoas automaticamente', () => {
      const template = toServiceTemplateObject({
        id: 'st-no-people',
        name: 'Modelo Litúrgico',
        activities: [
          { title: 'Louvor', category: 'Louvor', plannedDurationMinutes: 20 },
          { title: 'Sermão', category: 'Palavra', plannedDurationMinutes: 40 }
        ],
        parallelServices: [
          { teamId: 'som', serviceName: 'Sonoplastia', prepRequiredMinutes: 30, isDefaultActive: true },
          { teamId: 'midia', serviceName: 'Transmissão', prepRequiredMinutes: 20, isDefaultActive: true }
        ]
      });

      const baseEvent = { id: 'evt-test', title: 'Culto Teste', activities: [], parallelServices: [] };
      const eventEdition = instantiateTemplateForEvent(template, baseEvent);

      // Invariante CA03 em atividades
      for (const act of eventEdition.activities) {
        assert.equal(act.responsibleMemberId, null, 'Atividade não deve ter responsável automático');
        assert.deepEqual(act.roster, [], 'Atividade deve ter roster vazio');
      }

      // Invariante CA03 em serviços paralelos
      for (const serv of eventEdition.parallelServices) {
        assert.equal(serv.leaderId, null, 'Serviço paralelo não deve ter líder pré-escalado');
        assert.deepEqual(serv.volunteers, [], 'Serviço paralelo deve ter voluntários vazios');
      }
    });

    test('1.6 CA04: Alterações no modelo preservam os eventos e o histórico já existentes', () => {
      const template = toServiceTemplateObject({
        id: 'st-hist',
        name: 'Modelo Histórico v1',
        activities: [
          { id: 'ta-1', title: 'Boas-Vindas', plannedDurationMinutes: 5 }
        ],
        parallelServices: [
          { id: 'tps-1', teamId: 'som', serviceName: 'Sonoplastia', prepRequiredMinutes: 15, isDefaultActive: true }
        ]
      });

      // Evento criado com o modelo v1
      const pastEvent = instantiateTemplateForEvent(template, { id: 'evt-past', title: 'Culto Passado' });
      assert.equal(pastEvent.activities[0].title, 'Boas-Vindas');
      assert.equal(pastEvent.activities[0].plannedDurationMinutes, 5);

      // Posteriormente, o administrador altera o modelo (v2): adiciona louvor de 30 min e muda boas-vindas para 10 min
      template.activities[0].plannedDurationMinutes = 10;
      template.activities.push({ id: 'ta-2', title: 'Louvor', plannedDurationMinutes: 30 });

      // O EVENTO PASSADO PERMANECE 100% INALTERADO (IMUTABILIDADE HISTÓRICA)
      assert.equal(pastEvent.activities.length, 1);
      assert.equal(pastEvent.activities[0].plannedDurationMinutes, 5);

      // Verificação de bloqueio de exclusão quando o modelo está em uso conhecido na sessão
      const checkUsage = canDeleteServiceTemplate(template, [pastEvent]);
      assert.equal(checkUsage.canDelete, false);
      assert.match(checkUsage.reason, /já foi utilizado no planejamento/i);

      // Contenção quando o modelo não aparece no evento corrente em memória (evento corrente não comprova desuso global)
      const unusedTemplate = toServiceTemplateObject({ id: 'st-unused', name: 'Modelo Sem Uso Local' });
      const checkUnused = canDeleteServiceTemplate(unusedTemplate, [pastEvent]);
      assert.equal(checkUnused.canDelete, false);
      assert.match(checkUnused.reason, /não é possível comprovar ausência de uso histórico/i);
      assert.match(checkUnused.reason, /desative-o/i);
    });

    test('1.7 CA04: Modelo desativado (active = false) é rejeitado em instantiateTemplateForEvent', () => {
      const inactiveTemplate = toServiceTemplateObject({
        id: 'st-inactive',
        name: 'Modelo Desativado',
        active: false,
        activities: [{ title: 'Abertura', plannedDurationMinutes: 10 }],
        parallelServices: [{ teamId: 'som', serviceName: 'Sonoplastia', prepRequiredMinutes: 15, isDefaultActive: true }]
      });

      assert.throws(
        () => instantiateTemplateForEvent(inactiveTemplate, { id: 'evt-new', title: 'Novo Culto' }),
        /não é possível aplicar o modelo "Modelo Desativado" porque ele está desativado/i
      );
    });
  });

  describe('2. Integração de Componentes React (AdminView & PlanningView)', () => {
    test('2.1 AdminView renderiza aba de Modelos de Culto e permite alternância', () => {
      const renderer = renderWithProvider(React.createElement(AdminView), 'marcos');
      const root = renderer.root;

      const templateTabBtn = root.findByProps({ id: 'tab-admin-templates' });
      assert.ok(templateTabBtn, 'Botão da aba de Modelos de Culto deve existir');

      // Clica na aba de modelos
      act(() => {
        templateTabBtn.props.onClick();
      });

      // Verifica campos do formulário de modelos
      const nameInput = root.findByProps({ id: 'template-name-input' });
      assert.ok(nameInput, 'Campo de nome do modelo deve estar presente');
      const saveBtn = root.findByProps({ id: 'btn-save-template' });
      assert.ok(saveBtn, 'Botão de salvar modelo deve existir');
    });

    test('2.2 Administrador cadastra novo modelo reutilizável com atividades e apoios (CA01)', () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      renderWithProvider(
        React.createElement(React.Fragment, null,
          React.createElement(TestConsumer),
          React.createElement(AdminView)
        ),
        'marcos'
      );

      act(() => {
        const res = contextRef.addServiceTemplate({
          name: 'Culto Matutino de Louvor',
          description: 'Modelo matutino especial',
          activities: [
            { title: 'Oração Inicial', category: 'Liturgia', plannedDurationMinutes: 5 },
            { title: 'Louvor Congregacional', category: 'Louvor', plannedDurationMinutes: 30 }
          ],
          parallelServices: [
            { teamId: 'recepcao', serviceName: 'Portaria', prepRequiredMinutes: 10, isDefaultActive: true },
            { teamId: 'midia', serviceName: 'Transmissão', prepRequiredMinutes: 20, isDefaultActive: true }
          ]
        });
        assert.equal(res.success, true);
      });

      const added = contextRef.serviceTemplates.find(t => t.name === 'Culto Matutino de Louvor');
      assert.ok(added, 'Modelo cadastrado deve constar na lista de templates');
      assert.equal(added.activities.length, 2);
      assert.equal(added.parallelServices.length, 2);
    });

    test('2.3 Administrador desativa e reativa modelo reutilizável com preservação de estado', () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      renderWithProvider(
        React.createElement(TestConsumer),
        'marcos'
      );

      const target = contextRef.serviceTemplates[0];
      assert.ok(target);

      // Desativar
      act(() => {
        const res = contextRef.toggleServiceTemplateStatus(target.id);
        assert.equal(res.success, true);
        assert.equal(res.active, false);
      });

      let updated = contextRef.serviceTemplates.find(t => t.id === target.id);
      assert.equal(updated.active, false);

      // Reativar
      act(() => {
        const res = contextRef.toggleServiceTemplateStatus(target.id);
        assert.equal(res.success, true);
        assert.equal(res.active, true);
      });

      updated = contextRef.serviceTemplates.find(t => t.id === target.id);
      assert.equal(updated.active, true);
    });

    test('2.4 Membro não-administrador tem acesso administrativo bloqueado', () => {
      const renderer = renderWithProvider(React.createElement(AdminView), 'carlos');
      const root = renderer.root;

      const deniedCard = root.findByProps({ className: 'card admin-denied-card' });
      assert.ok(deniedCard, 'Membro comum deve ver aviso de Acesso Administrativo Restrito');
    });

    test('2.5 PlanningView: Aplicação de modelo à edição popula atividades e apoios sem alocar pessoas (CA02, CA03)', () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      const renderer = renderWithProvider(
        React.createElement(React.Fragment, null,
          React.createElement(TestConsumer),
          React.createElement(PlanningView)
        ),
        'marcos'
      );

      const root = renderer.root;

      // Seletor de modelo presente
      const selectTemplate = root.findByProps({ id: 'select-service-template' });
      assert.ok(selectTemplate, 'Seletor de modelo de culto deve estar presente no planejamento');

      // Aplica o modelo st-1
      act(() => {
        const res = contextRef.applyServiceTemplateToEvent('st-1');
        assert.equal(res.success, true);
      });

      // Atividades da edição populadas
      assert.equal(contextRef.event.activities.length, 7);
      // CA03: Nenhuma pessoa alocada automaticamente
      for (const actItem of contextRef.event.activities) {
        assert.equal(actItem.responsibleMemberId, null);
        assert.deepEqual(actItem.roster, []);
      }

      // Apoios da edição populados
      assert.equal(contextRef.event.parallelServices.length, 3);
      for (const serv of contextRef.event.parallelServices) {
        assert.equal(serv.leaderId, null);
        assert.deepEqual(serv.volunteers, []);
      }
    });

    test('2.6 PlanningView: Retirar transmissão desta edição não altera o modelo nem outros eventos (CA02)', () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      renderWithProvider(
        React.createElement(TestConsumer),
        'marcos'
      );

      // Aplica modelo com transmissão
      act(() => {
        contextRef.applyServiceTemplateToEvent('st-1');
      });

      const midiaService = contextRef.event.parallelServices.find(s => s.teamId === 'midia');
      assert.ok(midiaService, 'Transmissão deve existir no evento após aplicar o modelo st-1');

      // Remove a transmissão desta edição
      act(() => {
        const res = contextRef.removeParallelServiceFromCurrentEvent(midiaService.id);
        assert.equal(res.success, true);
      });

      // No evento atual, a transmissão foi removida
      assert.equal(contextRef.event.parallelServices.some(s => s.teamId === 'midia'), false);

      // No modelo original, a transmissão continua cadastrada por padrão (CA02)
      const templateSt1 = contextRef.serviceTemplates.find(t => t.id === 'st-1');
      assert.equal(templateSt1.parallelServices.some(s => s.teamId === 'midia'), true);
    });

    test('2.7 Proteção histórica: exclusão de modelo em uso é bloqueada (CA04)', () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      renderWithProvider(
        React.createElement(TestConsumer),
        'marcos'
      );

      // Evento está associado ao template st-1
      act(() => {
        contextRef.applyServiceTemplateToEvent('st-1');
      });

      // Tentativa de excluir st-1 deve ser bloqueada
      act(() => {
        const res = contextRef.deleteServiceTemplate('st-1');
        assert.equal(res.success, false);
        assert.match(res.error, /já foi utilizado no planejamento/i);
      });

      // Modelo continua presente na lista
      assert.ok(contextRef.serviceTemplates.find(t => t.id === 'st-1'));
    });

    test('2.8 Contenção de exclusão física quando não há prova global de desuso (CA04)', async () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      renderWithProvider(
        React.createElement(TestConsumer),
        'marcos'
      );

      // Cria um modelo novo que não está referenciado no evento corrente em memória
      act(() => {
        const res = contextRef.addServiceTemplate({
          name: 'Modelo Sem Evento Corrente',
          description: 'Teste de contenção',
          activities: [{ title: 'Prelúdio', category: 'Liturgia', plannedDurationMinutes: 5 }],
          parallelServices: []
        });
        assert.equal(res.success, true);
      });

      const target = contextRef.serviceTemplates.find(t => t.name === 'Modelo Sem Evento Corrente');
      assert.ok(target);

      // Tentativa de excluir fisicamente deve ser contida, pois o evento corrente/auditoria em memória não prova desuso global
      act(() => {
        const delRes = contextRef.deleteServiceTemplate(target.id);
        assert.equal(delRes.success, false);
        assert.match(delRes.error, /não é possível comprovar ausência de uso histórico/i);
        assert.match(delRes.error, /desative-o/i);
      });

      // Modelo permanece intacto e nenhum log de exclusão concluída foi registrado
      assert.ok(contextRef.serviceTemplates.find(t => t.id === target.id));
      assert.equal(
        contextRef.auditLogs.some(entry => entry.action === 'Exclusão de Modelo de Culto'),
        false,
        'Não deve registrar auditoria de exclusão quando a operação foi recusada'
      );

      // Validação do cliente remoto mockado: exige contrato completo (success === true, deleted === true, template_id === target.id)
      const invalidReceipts = [
        { label: 'deleted ausente', payload: { success: true, template_id: target.id, name: target.name } },
        { label: 'result.template_id ausente', payload: { success: true, deleted: true } },
        { label: 'result.template_id nulo', payload: { success: true, deleted: true, template_id: null } },
        { label: 'result.template_id inválido', payload: { success: true, deleted: true, template_id: 'id-malformado' } },
        { label: 'result.template_id divergente', payload: { success: true, deleted: true, template_id: '00000000-0000-4000-8000-000000000999' } },
        { label: 'success como string "true"', payload: { success: 'true', deleted: true, template_id: target.id } },
        { label: 'deleted como string "true"', payload: { success: true, deleted: 'true', template_id: target.id } },
      ];

      for (const item of invalidReceipts) {
        const mockClientInvalid = {
          rpc: async () => ({ data: item.payload, error: null })
        };
        const invalidRes = await deleteServiceTemplateRemote(mockClientInvalid, 'church-1', target.id);
        assert.equal(invalidRes.success, false, `Recibo inválido (${item.label}) não pode gerar sucesso de exclusão`);
      }

      // Conflito de command_id (23505) e autorização revogada (42501) propagam erro sem falso sucesso
      const mockClientConflict = {
        rpc: async () => ({
          data: null,
          error: { code: '23505', message: 'Conflito de command_id: identificador já utilizado para outra operação.' }
        })
      };
      const conflictRes = await deleteServiceTemplateRemote(mockClientConflict, 'church-1', target.id);
      assert.equal(conflictRes.success, false);
      assert.match(conflictRes.error, /conflito de comando/i);

      const mockClientRevoked = {
        rpc: async () => ({
          data: null,
          error: { code: '42501', message: 'Permissão insuficiente. Apenas administradores podem excluir modelos de culto.' }
        })
      };
      const revokedRes = await deleteServiceTemplateRemote(mockClientRevoked, 'church-1', target.id);
      assert.equal(revokedRes.success, false);
      assert.match(revokedRes.error, /permissão insuficiente/i);

      // Replay histórico legítimo (contrato completo e mesmo template_id) é aceito pelo wrapper remoto
      const mockClientValidReplay = {
        rpc: async () => ({
          data: { success: true, deleted: true, template_id: target.id },
          error: null
        })
      };
      const validReplayRes = await deleteServiceTemplateRemote(mockClientValidReplay, 'church-1', target.id);
      assert.equal(validReplayRes.success, true);
      assert.equal(validReplayRes.receipt.template_id, target.id);

      const mockClientContainment = {
        rpc: async () => ({
          data: null,
          error: {
            code: '23503',
            message: 'Não é possível comprovar ausência de uso histórico para exclusão física deste modelo de culto. Recomenda-se desativá-lo para que não seja mais selecionado em novos planejamentos.'
          }
        })
      };
      const containmentRes = await deleteServiceTemplateRemote(mockClientContainment, 'church-1', target.id);
      assert.equal(containmentRes.success, false);
      assert.match(containmentRes.error, /não é possível comprovar ausência de uso histórico/i);
    });

    test('2.9 Modelo desativado é rejeitado no handler applyServiceTemplateToEvent e no cliente remoto mockado, preservando cópias já criadas e modelos ativos (CA04)', async () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useApp();
        return null;
      }

      renderWithProvider(
        React.createElement(TestConsumer),
        'marcos'
      );

      // 1. Aplica o modelo ativo st-1 para criar uma cópia inicial no evento
      act(() => {
        const applyActive = contextRef.applyServiceTemplateToEvent('st-1');
        assert.equal(applyActive.success, true);
      });

      const snapshotActivitiesBefore = JSON.parse(JSON.stringify(contextRef.event.activities));
      const snapshotServicesBefore = JSON.parse(JSON.stringify(contextRef.event.parallelServices));

      // 2. Cadastra um segundo modelo e o desativa
      let inactiveId;
      act(() => {
        const created = contextRef.addServiceTemplate({
          name: 'Modelo Especial Inativo',
          description: 'Será desativado',
          activities: [{ title: 'Vigília', category: 'Oração', plannedDurationMinutes: 60 }],
          parallelServices: []
        });
        assert.equal(created.success, true);
      });

      const secondModel = contextRef.serviceTemplates.find(t => t.name === 'Modelo Especial Inativo');
      assert.ok(secondModel);
      inactiveId = secondModel.id;

      act(() => {
        const toggled = contextRef.toggleServiceTemplateStatus(inactiveId);
        assert.equal(toggled.success, true);
        assert.equal(toggled.active, false);
      });

      // 3. Tentar aplicar o modelo desativado via handler deve falhar e preservar o evento existente intacto
      act(() => {
        const applyInactive = contextRef.applyServiceTemplateToEvent(inactiveId);
        assert.equal(applyInactive.success, false);
        assert.match(applyInactive.error, /desativado/i);
      });

      assert.equal(contextRef.event.templateId, 'st-1', 'Evento existente deve preservar referência anterior');
      assert.deepEqual(contextRef.event.activities, snapshotActivitiesBefore, 'Atividades já criadas no evento devem permanecer intactas');
      assert.deepEqual(contextRef.event.parallelServices, snapshotServicesBefore, 'Apoios já criados no evento devem permanecer intactos');

      // 4. Em modo remoto mockado, applyServiceTemplateToEvent barra modelo inativo antes de chamar a RPC
      let remoteContextRef;
      function RemoteConsumer() {
        remoteContextRef = useApp();
        return null;
      }
      let instantiateRpcCalled = false;
      const mockRemoteClient = {
        rpc: async (fn) => {
          if (fn === 'instantiate_service_template') {
            instantiateRpcCalled = true;
            return {
              data: null,
              error: { code: '23514', message: 'Modelo de culto desativado não pode ser aplicado a novos planejamentos.' }
            };
          }
          if (fn === 'list_service_templates') {
            return {
              data: [
                { id: '00000000-0000-4000-8000-000000000078', name: 'Modelo Remoto Inativo', active: false }
              ],
              error: null
            };
          }
          if (fn === 'get_service_template') {
            return {
              data: {
                id: '00000000-0000-4000-8000-000000000078',
                name: 'Modelo Remoto Inativo',
                active: false,
                activities: [{ title: 'Abertura', category: 'Liturgia', planned_duration_minutes: 10, display_order: 1 }],
                parallel_services: []
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
              churchId: '00000000-0000-4000-8000-000000000100',
              supabaseClient: mockRemoteClient
            },
            React.createElement(RemoteConsumer)
          )
        );
      });

      await act(async () => {
        await remoteContextRef.reloadRemoteData();
      });

      let remoteApplyRes;
      await act(async () => {
        remoteApplyRes = await remoteContextRef.applyServiceTemplateToEvent('00000000-0000-4000-8000-000000000078');
      });

      assert.equal(remoteApplyRes.success, false);
      assert.match(remoteApplyRes.error, /desativado/i);
      assert.equal(instantiateRpcCalled, false, 'Handler deve barrar modelo inativo antes de disparar RPC remota');

      // 5. E se instantiateServiceTemplateRemote for chamada diretamente contra RPC que retorna 23514:
      const directRpcRes = await instantiateServiceTemplateRemote(
        mockRemoteClient,
        '00000000-0000-4000-8000-000000000100',
        '00000000-0000-4000-8000-000000000078'
      );
      assert.equal(instantiateRpcCalled, true);
      assert.equal(directRpcRes.success, false);
      assert.match(directRpcRes.error, /desativado/i);
    });
  });
});
