import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  normalizeNfcText,
  validateEventType,
  validateStandardActivity,
  isEventTypeUsed,
  isStandardActivityUsed,
  canDeleteEventType,
  canDeleteStandardActivity,
  eventTypeActivityErrorMessage,
  toEventTypeObject,
  toStandardActivityObject,
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  MAX_DESC_LENGTH,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES
} from '../src/utils/eventTypeActivityService.js';

// Prepara bundle para teste de componentes React
const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'event-types-activities-components.bundle.mjs');

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

describe('Issue #25: Manter tipos de evento e atividades com durações padrão', () => {
  describe('1. Unidades de Serviço: eventTypeActivityService', () => {
    test('1.1 Normalização em NFC e trim', () => {
      const accented = '  Culto de Celebração e Comunhão  ';
      const clean = normalizeNfcText(accented);
      assert.equal(clean, 'Culto de Celebração e Comunhão');
      assert.equal(clean.isWellFormed ? clean.isWellFormed() : true, true);
      assert.equal(normalizeNfcText(null), '');
      assert.equal(normalizeNfcText(undefined), '');
    });

    test('1.2 Validação de Tipos de Evento', () => {
      const existing = [
        { id: 'et-1', name: 'Culto de Domingo', active: true }
      ];

      // Obrigatório
      const empty = validateEventType('', '', existing);
      assert.equal(empty.valid, false);
      assert.match(empty.error, /obrigatório/i);

      // Limite máximo
      const long = validateEventType('A'.repeat(MAX_NAME_LENGTH + 1), '', existing);
      assert.equal(long.valid, false);
      assert.match(long.error, /máximo 100 caracteres/i);

      // Descrição acima de 255
      const longDesc = validateEventType('Culto', 'D'.repeat(MAX_DESC_LENGTH + 1), existing);
      assert.equal(longDesc.valid, false);
      assert.match(longDesc.error, /máximo 255 caracteres/i);

      // Duplicidade case-insensitive e trim
      const dup = validateEventType('  culto de domingo  ', '', existing);
      assert.equal(dup.valid, false);
      assert.match(dup.error, /já existe/i);

      // Sucesso
      const ok = validateEventType('Culto de Oração', 'Estudo e oração', existing);
      assert.equal(ok.valid, true);
      assert.equal(ok.cleanName, 'Culto de Oração');
      assert.equal(ok.cleanDesc, 'Estudo e oração');
    });

    test('1.3 Validação de Atividades Padrão e Durações (CA02)', () => {
      const existing = [
        { id: 'sa-1', name: 'Louvor Congregacional', defaultDurationMinutes: 25, active: true }
      ];

      // Duração zero ou negativa
      const zero = validateStandardActivity('Louvor', 0, 'Louvor', '', existing);
      assert.equal(zero.valid, false);
      assert.match(zero.error, /entre 1 e 720 minutos/i);

      // Duração acima de 720 min
      const excess = validateStandardActivity('Louvor', 721, 'Louvor', '', existing);
      assert.equal(excess.valid, false);
      assert.match(excess.error, /entre 1 e 720 minutos/i);

      // Duração configurável arbitrária (ex: 3 min, 12 min, 45 min, 90 min) aceita com sucesso
      const valid3 = validateStandardActivity('Oração Rápida', 3, 'Liturgia', '', existing);
      assert.equal(valid3.valid, true);
      assert.equal(valid3.cleanDuration, 3);

      const valid45 = validateStandardActivity('Palavra Central', 45, 'Palavra', '', existing);
      assert.equal(valid45.valid, true);
      assert.equal(valid45.cleanDuration, 45);

      // Duplicidade
      const dup = validateStandardActivity('louvor congregacional', 25, 'Louvor', '', existing);
      assert.equal(dup.valid, false);
      assert.match(dup.error, /já existe/i);
    });

    test('1.4 Proteção de referências e exclusão física (CA03)', () => {
      const mockEvents = [
        { id: 'ev-1', title: 'Culto de Celebração de Domingo', type: 'Celebração Geral', eventTypeId: 'et-1' }
      ];
      const mockActivities = [
        { id: 'act-1', title: 'Louvor e Adoração Congregacional', standardActivityId: 'sa-2' }
      ];

      // Tipo em uso
      assert.equal(isEventTypeUsed({ id: 'et-1', name: 'Celebração Geral' }, mockEvents), true);
      const checkTypeUsed = canDeleteEventType({ id: 'et-1', name: 'Celebração Geral' }, mockEvents);
      assert.equal(checkTypeUsed.canDelete, false);
      assert.match(checkTypeUsed.message, /não pode ser excluído fisicamente/i);

      // Tipo livre
      assert.equal(isEventTypeUsed({ id: 'et-99', name: 'Ensaio Extra' }, mockEvents), false);
      const checkTypeFree = canDeleteEventType({ id: 'et-99', name: 'Ensaio Extra' }, mockEvents);
      assert.equal(checkTypeFree.canDelete, true);

      // Atividade em uso
      assert.equal(isStandardActivityUsed({ id: 'sa-2', name: 'Louvor e Adoração Congregacional' }, mockActivities), true);
      const checkActUsed = canDeleteStandardActivity({ id: 'sa-2', name: 'Louvor e Adoração Congregacional' }, mockActivities);
      assert.equal(checkActUsed.canDelete, false);
      assert.match(checkActUsed.message, /não pode ser excluída fisicamente/i);

      // Atividade livre
      assert.equal(isStandardActivityUsed({ id: 'sa-99', name: 'Dança Especial' }, mockActivities), false);
      const checkActFree = canDeleteStandardActivity({ id: 'sa-99', name: 'Dança Especial' }, mockActivities);
      assert.equal(checkActFree.canDelete, true);
    });

    test('1.5 Mensagens de erro padronizadas', () => {
      assert.match(eventTypeActivityErrorMessage({ code: '42501' }), /administradores autorizados/i);
      assert.match(eventTypeActivityErrorMessage({ code: '23505' }), /já existe um cadastro com este nome/i);
      assert.match(eventTypeActivityErrorMessage({ code: '23503' }), /não pode ser excluído.*desative-o/i);
      assert.match(eventTypeActivityErrorMessage({ code: '23514' }), /dados informados inválidos/i);
    });
  });

  describe('2. Critério CA01: Cadastros e edições web por administrador autorizado', () => {
    test('2.1 Administrador consegue cadastrar e editar tipos e atividades', () => {
      let appContext;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      renderWithProvider(React.createElement(TestConsumer), 'marcos');
      assert.equal(appContext.isAdmin, true);

      // Cadastrar Tipo de Evento
      let resType;
      act(() => {
        resType = appContext.addEventType('Culto de Cura e Libertação', 'Culto temático às terças-feiras');
      });
      assert.equal(resType.success, true);
      assert.equal(resType.eventType.name, 'Culto de Cura e Libertação');

      // Alterar Tipo de Evento
      act(() => {
        const updateType = appContext.updateEventType(resType.eventType.id, 'Culto de Cura e Milagres', 'Descrição atualizada');
        assert.equal(updateType.success, true);
      });

      // Cadastrar Atividade Padrão com Duração (ex: 18 min)
      let resAct;
      act(() => {
        resAct = appContext.addStandardActivity('Testemunhos da Congregação', 18, 'Liturgia', 'Relato dos membros');
      });
      assert.equal(resAct.success, true);
      assert.equal(resAct.activity.name, 'Testemunhos da Congregação');
      assert.equal(resAct.activity.defaultDurationMinutes, 18);

      // Alterar Atividade Padrão
      act(() => {
        const updateAct = appContext.updateStandardActivity(resAct.activity.id, 'Testemunhos e Louvor de Gratidão', 20, 'Liturgia', 'Ajuste de tempo');
        assert.equal(updateAct.success, true);
      });
    });

    test('2.2 Membro comum não tem permissão para cadastrar ou editar (CA04)', () => {
      let appContext;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      renderWithProvider(React.createElement(TestConsumer), 'carlos');
      assert.equal(appContext.isAdmin, false);

      let resType;
      act(() => {
        resType = appContext.addEventType('Tentativa Invasora');
      });
      assert.equal(resType.success, false);
      assert.match(resType.error, /apenas administradores/i);

      let resAct;
      act(() => {
        resAct = appContext.addStandardActivity('Atividade Não Autorizada', 15);
      });
      assert.equal(resAct.success, false);
      assert.match(resAct.error, /apenas administradores/i);

      let toggleType;
      act(() => {
        toggleType = appContext.toggleEventTypeStatus('et-1');
      });
      assert.equal(toggleType.success, false);

      let deleteAct;
      act(() => {
        deleteAct = appContext.deleteStandardActivity('sa-1');
      });
      assert.equal(deleteAct.success, false);
    });
  });

  describe('3. Critério CA02: Duração padrão configurável sem valores universais', () => {
    test('3.1 Aceita durações variadas como 3, 12, 45, 90, 180 min sem impor 5, 15 ou 20 min', () => {
      let appContext;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      renderWithProvider(React.createElement(TestConsumer), 'marcos');

      let d1, d2, d3, d4;
      act(() => {
        d1 = appContext.addStandardActivity('Momento Kids', 7, 'Liturgia');
        d2 = appContext.addStandardActivity('Oração Intercessória', 12, 'Liturgia');
        d3 = appContext.addStandardActivity('Estudo Temático Aprofundado', 55, 'Palavra');
        d4 = appContext.addStandardActivity('Vigília Noturna', 180, 'Liturgia');
      });

      assert.equal(d1.success, true);
      assert.equal(d1.activity.defaultDurationMinutes, 7);
      assert.equal(d2.success, true);
      assert.equal(d2.activity.defaultDurationMinutes, 12);
      assert.equal(d3.success, true);
      assert.equal(d3.activity.defaultDurationMinutes, 55);
      assert.equal(d4.success, true);
      assert.equal(d4.activity.defaultDurationMinutes, 180);
    });
  });

  describe('4. Critério CA03: Alterar ou retirar preserva referências e histórico existentes', () => {
    test('4.1 Alterar atividade padrão não reescreve cultos já planejados ou realizados', () => {
      let appContext;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      renderWithProvider(React.createElement(TestConsumer), 'marcos');

      // Verifica duração e título originais do culto em planejamento
      const originalLouvor = appContext.event.activities.find(a => a.id === 'act-2');
      assert.equal(originalLouvor.plannedDurationMinutes, 25);
      assert.equal(originalLouvor.title, 'Louvor e Adoração Congregacional');

      // Altera a atividade padrão sa-2 (Louvor) para 35 minutos e outro nome
      act(() => {
        const updateRes = appContext.updateStandardActivity(
          'sa-2',
          'Louvor Prolongado e Espontâneo',
          35,
          'Louvor',
          'Novo tempo padrão para o louvor'
        );
        assert.equal(updateRes.success, true);
      });

      // O culto existente NÃO foi reescrito silenciosamente
      const currentLouvor = appContext.event.activities.find(a => a.id === 'act-2');
      assert.equal(currentLouvor.plannedDurationMinutes, 25);
      assert.equal(currentLouvor.title, 'Louvor e Adoração Congregacional');
    });

    test('4.2 Desativação preserva cultos existentes e bloqueia exclusão de referências', () => {
      let appContext;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      renderWithProvider(React.createElement(TestConsumer), 'marcos');

      // Desativa a atividade padrão sa-2
      act(() => {
        const toggleRes = appContext.toggleStandardActivityStatus('sa-2');
        assert.equal(toggleRes.success, true);
        assert.equal(toggleRes.active, false);
      });

      // O culto existente mantém a atividade sem quebrar referências
      assert.equal(appContext.event.activities.some(a => a.id === 'act-2'), true);

      // Tentativa de excluir fisicamente sa-2 que está no culto é estritamente bloqueada
      let deleteUsed;
      act(() => {
        deleteUsed = appContext.deleteStandardActivity('sa-2');
      });
      assert.equal(deleteUsed.success, false);
      assert.match(deleteUsed.error, /não pode ser excluída fisicamente/i);

      // Excluir atividade cadastrada sem referências em nenhum culto é permitido
      let newFreeAct, deleteFree;
      act(() => {
        newFreeAct = appContext.addStandardActivity('Atividade Rascunho Livre', 10);
      });
      assert.equal(newFreeAct.success, true);

      act(() => {
        deleteFree = appContext.deleteStandardActivity(newFreeAct.activity.id);
      });
      assert.equal(deleteFree.success, true);

      // Mesma garantia para Tipo de Evento: tentar excluir o tipo 'Celebração Geral' usado no evento atual é bloqueado
      const targetType = appContext.eventTypes.find(t => t.name === 'Celebração Geral');
      assert.ok(targetType);

      let deleteUsedType;
      act(() => {
        deleteUsedType = appContext.deleteEventType(targetType.id);
      });
      assert.equal(deleteUsedType.success, false);
      assert.match(deleteUsedType.error, /não pode ser excluído fisicamente/i);
    });
  });

  describe('5. Interface de Administração e Planejamento (AdminView & PlanningView)', () => {
    test('5.1 AdminView renderiza abas e botões de Tipos e Atividades para Administrador', () => {
      const renderer = renderWithProvider(React.createElement(AdminView), 'marcos');
      const root = renderer.root;

      // Abas presentes no cabeçalho
      const tabEventTypes = root.findByProps({ id: 'tab-admin-event-types' });
      assert.ok(tabEventTypes);

      const tabActivities = root.findByProps({ id: 'tab-admin-activities' });
      assert.ok(tabActivities);
    });

    test('5.2 AdminView bloqueia visualização de gerenciamento para membros comuns (CA04)', () => {
      const renderer = renderWithProvider(React.createElement(AdminView), 'beatriz');
      const root = renderer.root;

      const deniedCard = root.findByProps({ className: 'card admin-denied-card' });
      assert.ok(deniedCard);

      // Não exibe abas administrativas para membros sem privilégios
      assert.throws(() => root.findByProps({ id: 'tab-admin-event-types' }));
      assert.throws(() => root.findByProps({ id: 'tab-admin-activities' }));
    });

    test('5.3 PlanningView possui seletor para carregar a partir de atividades padrão cadastradas', () => {
      const renderer = renderWithProvider(React.createElement(PlanningView), 'carlos');
      const root = renderer.root;

      // Abre o modal de nova etapa
      const openBtn = root.findByProps({ id: 'btn-open-new-activity-modal' });
      act(() => {
        openBtn.props.onClick();
      });

      // Modal de atividade possui o select para template padrão
      const selectTemplate = root.findByProps({ id: 'select-standard-activity-template' });
      assert.ok(selectTemplate);
    });
  });
});
