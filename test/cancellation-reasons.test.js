import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  normalizeNfcReason,
  validateCancellationReason,
  isReasonUsedInActivities,
  canDeleteCancellationReason,
  getActiveReasons,
  toReasonObject,
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
  cancellationReasonErrorMessage
} from '../src/utils/cancellationReasonService.js';

// Prepara bundle para teste de componentes
const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'cancellation-reasons-components.bundle.mjs');

await build({
  stdin: {
    contents: `
      export { AppProvider, useApp } from './src/context/AppContext.jsx';
      export { default as AdminView } from './src/components/AdminView.jsx';
      export { default as LiveConsole } from './src/components/LiveConsole.jsx';
      export { default as ScheduleView } from './src/components/ScheduleView.jsx';
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

const { AppProvider, useApp, AdminView, LiveConsole, ScheduleView } = await import(
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

let currentRenderer = null;

// Helper para montar árvore com Provider e garantir cleanup
function renderWithProvider(ui, initialUserId = 'marcos') {
  if (currentRenderer) {
    try {
      act(() => currentRenderer.unmount());
    } catch {}
    currentRenderer = null;
  }
  act(() => {
    currentRenderer = TestRenderer.create(
      React.createElement(AppProvider, { initialUserId }, ui)
    );
  });
  return currentRenderer;
}

describe('Issue #26: Manter motivos de cancelamento de atividades', () => {
  describe('1. Unidades de Serviço: cancellationReasonService', () => {
    test('1.1 Normalização em NFC e trim', () => {
      assert.equal(normalizeNfcReason('  Falha no som  '), 'Falha no som');
      assert.equal(normalizeNfcReason(null), '');
      assert.equal(normalizeNfcReason(123), '');
      // Unicode de-composto vs composto
      const decomposed = 'e\u0301'; // é decomposto
      const normalized = normalizeNfcReason(`  Caf${decomposed}  `);
      assert.equal(normalized, 'Café');
      assert.equal(normalized.normalize('NFD'), `Cafe\u0301`);
    });

    test('1.2 Validação de tamanho e obrigatoriedade', () => {
      // Vazio
      const emptyRes = validateCancellationReason('   ');
      assert.equal(emptyRes.valid, false);
      assert.match(emptyRes.error, /obrigatória/i);

      // Limite máximo 120 caracteres
      const maxOk = 'A'.repeat(MAX_REASON_LENGTH);
      const validRes = validateCancellationReason(maxOk);
      assert.equal(validRes.valid, true);
      assert.equal(validRes.cleanName, maxOk);

      const tooLong = 'B'.repeat(MAX_REASON_LENGTH + 1);
      const invalidRes = validateCancellationReason(tooLong);
      assert.equal(invalidRes.valid, false);
      assert.match(invalidRes.error, /120 caracteres/);
    });

    test('1.3 Detecção de duplicidade (case-insensitive e NFC)', () => {
      const existing = [
        { id: 'cr-1', name: 'Falta de Energia Elétrica', active: true },
        { id: 'cr-2', name: 'Falha Técnica de Som', active: true },
      ];

      // Exato
      const dup1 = validateCancellationReason('Falta de Energia Elétrica', existing);
      assert.equal(dup1.valid, false);
      assert.match(dup1.error, /já existe um motivo/i);

      // Variação de caixa
      const dup2 = validateCancellationReason('falta de energia elétrica', existing);
      assert.equal(dup2.valid, false);
      assert.match(dup2.error, /já existe um motivo/i);

      // Com espaços adicionais
      const dup3 = validateCancellationReason('   FALHA TÉCNICA DE SOM   ', existing);
      assert.equal(dup3.valid, false);

      // Edição do próprio item permite manter o mesmo nome
      const selfEdit = validateCancellationReason('Falta de Energia Elétrica', existing, 'cr-1');
      assert.equal(selfEdit.valid, true);

      // Edição tentando colidir com outro item
      const collisionEdit = validateCancellationReason('Falha Técnica de Som', existing, 'cr-1');
      assert.equal(collisionEdit.valid, false);

      // Novo motivo único
      const unique = validateCancellationReason('Emergência Médica', existing);
      assert.equal(unique.valid, true);
      assert.equal(unique.cleanName, 'Emergência Médica');
    });

    test('1.4 Proteção de histórico: isReasonUsedInActivities e canDeleteCancellationReason', () => {
      const mockActivities = [
        { id: 'act-1', title: 'Boas-vindas', status: 'concluida' },
        {
          id: 'act-2',
          title: 'Louvor 1',
          status: 'cancelada',
          cancellationReason: 'Falta de energia elétrica',
          cancellationReasonId: 'cr-2',
        },
      ];

      const reasonInUse = { id: 'cr-2', name: 'Falta de energia elétrica', active: true };
      const reasonUnused = { id: 'cr-99', name: 'Motivo Novo Não Utilizado', active: true };

      // Verificação por ID e por nome
      assert.equal(isReasonUsedInActivities(reasonInUse, mockActivities), true);
      assert.equal(isReasonUsedInActivities('cr-2', mockActivities), true);
      assert.equal(isReasonUsedInActivities('Falta de energia elétrica', mockActivities), true);
      assert.equal(isReasonUsedInActivities(reasonUnused, mockActivities), false);

      // Proteção contra deleção
      const deleteUsedCheck = canDeleteCancellationReason(reasonInUse, mockActivities);
      assert.equal(deleteUsedCheck.canDelete, false);
      assert.match(deleteUsedCheck.message, /já foi utilizado em cancelamentos históricos e não pode ser excluído/i);

      const deleteUnusedCheck = canDeleteCancellationReason(reasonUnused, mockActivities);
      assert.equal(deleteUnusedCheck.canDelete, true);
      assert.equal(deleteUnusedCheck.message, null);
    });

    test('1.5 Filtragem de motivos ativos com getActiveReasons', () => {
      const mixed = [
        { id: 'cr-1', name: 'Motivo 1', active: true },
        { id: 'cr-2', name: 'Motivo 2', active: false },
        { id: 'cr-3', name: 'Motivo 3' }, // default true
      ];

      const actives = getActiveReasons(mixed);
      assert.equal(actives.length, 2);
      assert.equal(actives[0].id, 'cr-1');
      assert.equal(actives[1].id, 'cr-3');
    });
  });

  describe('2. Critério CA01: Lista configurável por administrador na Web', () => {
    test('2.1 Administrador consegue cadastrar novo motivo customizado sem opções fixas obrigatórias', () => {
      let appContext;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      renderWithProvider(React.createElement(TestConsumer), 'marcos'); // Marcos é Admin

      assert.equal(appContext.isAdmin, true);
      const initialCount = appContext.cancelReasons.length;

      let res;
      act(() => {
        res = appContext.addCancelReason('Queda de link de internet / streaming');
      });

      assert.equal(res.success, true);
      assert.equal(appContext.cancelReasons.length, initialCount + 1);
      const created = appContext.cancelReasons.find(r => r.name === 'Queda de link de internet / streaming');
      assert.ok(created);
      assert.equal(created.active, true);
    });

    test('2.2 Administrador consegue renomear e desativar motivo existente', () => {
      let appContext;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      renderWithProvider(React.createElement(TestConsumer), 'marcos');

      const target = appContext.cancelReasons[0];
      const targetId = target.id;

      // Renomear
      act(() => {
        const updateRes = appContext.updateCancelReason(targetId, 'Falha geral de microfones e som');
        assert.equal(updateRes.success, true);
      });

      const updated = appContext.cancelReasons.find(r => r.id === targetId);
      assert.equal(updated.name, 'Falha geral de microfones e som');

      // Desativar
      act(() => {
        const toggleRes = appContext.toggleCancelReasonStatus(targetId);
        assert.equal(toggleRes.success, true);
        assert.equal(toggleRes.active, false);
      });

      const deactivated = appContext.cancelReasons.find(r => r.id === targetId);
      assert.equal(deactivated.active, false);

      // Reativar
      act(() => {
        const toggleRes2 = appContext.toggleCancelReasonStatus(targetId);
        assert.equal(toggleRes2.success, true);
        assert.equal(toggleRes2.active, true);
      });
      assert.equal(appContext.cancelReasons.find(r => r.id === targetId).active, true);
    });

    test('2.3 Administrador pode excluir motivo nunca utilizado', () => {
      let appContext;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      renderWithProvider(React.createElement(TestConsumer), 'marcos');

      let addRes;
      act(() => {
        addRes = appContext.addCancelReason('Motivo temporário descartável');
      });
      assert.equal(addRes.success, true);

      const createdId = addRes.reason.id;
      assert.ok(appContext.cancelReasons.some(r => r.id === createdId));

      act(() => {
        const delRes = appContext.deleteCancelReason(createdId);
        assert.equal(delRes.success, true);
      });

      assert.equal(appContext.cancelReasons.some(r => r.id === createdId), false);
    });

    test('2.4 Usuário sem perfil de administrador tem operações rejeitadas', () => {
      let appContext;
      function TestConsumer() {
        appContext = useApp();
        return null;
      }

      // Carlos é Líder da Liturgia, NÃO é Admin global
      renderWithProvider(React.createElement(TestConsumer), 'carlos');

      act(() => {
        appContext.setCurrentUserId('carlos');
      });

      assert.equal(appContext.isAdmin, false);

      act(() => {
        const resAdd = appContext.addCancelReason('Tentativa Não Autorizada');
        assert.equal(resAdd.success, false);
        assert.match(resAdd.error, /administrador/i);

        const resUpdate = appContext.updateCancelReason('cr-1', 'Tentativa');
        assert.equal(resUpdate.success, false);

        const resToggle = appContext.toggleCancelReasonStatus('cr-1');
        assert.equal(resToggle.success, false);

        const resDel = appContext.deleteCancelReason('cr-1');
        assert.equal(resDel.success, false);
      });
    });
  });

  describe('3. Critério CA02 e CA04: Operação de cancelamento litúrgico sem cadastro operacional e sem justificativa livre', () => {
    test('3.1 LiveConsole consome apenas motivos ativos e não oferece cadastro administrativo na tela', () => {
      let appContext;
      function Consumer() {
        appContext = useApp();
        return React.createElement(LiveConsole);
      }

      let renderer;
      act(() => {
        renderer = renderWithProvider(React.createElement(Consumer), 'carlos');
      });

      // Inicia culto e primeira atividade para colocar em execução
      act(() => {
        appContext.startService();
        appContext.startActivity(0);
      });

      // Abre o modal de cancelamento
      const openBtn = renderer.root.findByProps({ id: 'btn-open-cancel-modal' });
      act(() => {
        openBtn.props.onClick();
      });

      // Verifica select de motivos
      const select = renderer.root.findByProps({ id: 'cancel-reason-select' });
      assert.ok(select, 'Select de motivos de cancelamento deve estar presente');

      // Verifica que não há textarea para justificação livre (CA04)
      const textareas = renderer.root.findAllByType('textarea');
      assert.equal(textareas.length, 0, 'Não deve haver campo de texto livre para relatos pessoais');

      // Verifica que não há formulário ou botão de adicionar motivo no modal operacional (CA02 / M12)
      const addButtonsInModal = renderer.root.findAll(el =>
        el.type === 'button' && (el.props.id === 'btn-add-cancel-reason' || (el.children && el.children.includes('Cadastrar Novo Motivo')))
      );
      assert.equal(addButtonsInModal.length, 0, 'Não deve haver cadastro de motivo na tela operacional');
    });

    test('3.2 Bloqueio de cancelamento com alerta explícito quando não há motivos ativos', () => {
      let appContext;
      function Consumer() {
        appContext = useApp();
        return React.createElement(LiveConsole);
      }

      let renderer;
      act(() => {
        renderer = renderWithProvider(React.createElement(Consumer), 'marcos');
      });

      // Desativa todos os motivos como admin
      act(() => {
        appContext.cancelReasons.forEach(r => {
          appContext.toggleCancelReasonStatus(r.id);
        });
      });

      // Muda para Carlos (Liturgia) e inicia atividade
      act(() => {
        appContext.setCurrentUserId('carlos');
      });
      act(() => {
        appContext.startService();
        appContext.startActivity(0);
      });

      // Abre modal de cancelamento
      const openBtn = renderer.root.findByProps({ id: 'btn-open-cancel-modal' });
      act(() => {
        openBtn.props.onClick();
      });

      // Alerta de ausência de motivos ativos deve estar visível
      const emptyAlert = renderer.root.findByProps({ id: 'empty-cancel-reasons-alert' });
      assert.ok(emptyAlert, 'Alerta de motivos ausentes deve ser exibido');

      // Botão de confirmação de cancelamento deve estar desabilitado
      const confirmBtn = renderer.root.findByProps({ id: 'btn-confirm-cancel-activity' });
      assert.equal(confirmBtn.props.disabled, true);
    });
  });

  describe('4. Critério CA03: Alterar ou desativar motivo preserva interpretação e referências históricas', () => {
    test('4.1 Cancelamento registra snapshot textual e id de referência na atividade', () => {
      let appContext;
      function Consumer() {
        appContext = useApp();
        return null;
      }

      renderWithProvider(React.createElement(Consumer), 'carlos');

      // Inicia o culto e a primeira atividade
      act(() => {
        appContext.startService();
        appContext.startActivity(0);
      });

      const currentIdx = appContext.event.currentActivityIndex;

      // Executa o cancelamento com motivo cr-2
      const targetReason = appContext.cancelReasons.find(r => r.id === 'cr-2');
      act(() => {
        const cancelRes = appContext.cancelActivity(targetReason);
        assert.equal(cancelRes.success, true);
      });

      const cancelledAct = appContext.event.activities[currentIdx];
      assert.equal(cancelledAct.status, 'cancelada');
      assert.equal(cancelledAct.cancellationReason, targetReason.name);
      assert.equal(cancelledAct.cancellationReasonId, targetReason.id);
      assert.equal(cancelledAct.cancelledBy, appContext.currentUser.name);

      // Agora desativa o motivo cr-2 como admin Marcos
      act(() => {
        appContext.setCurrentUserId('marcos'); // Admin
      });
      act(() => {
        const toggleRes = appContext.toggleCancelReasonStatus('cr-2');
        assert.equal(toggleRes.success, true);
        assert.equal(toggleRes.active, false);
      });

      // O histórico da atividade cancelada permanece intacto
      assert.equal(appContext.event.activities[currentIdx].cancellationReason, targetReason.name);
      assert.equal(appContext.event.activities[currentIdx].cancellationReasonId, 'cr-2');

      // Tenta excluir o motivo cr-2 que está em histórico: DEVE SER BLOQUEADO!
      act(() => {
        const delRes = appContext.deleteCancelReason('cr-2');
        assert.equal(delRes.success, false);
        assert.match(delRes.error, /utilizado em cancelamentos.*não pode ser excluído/i);
      });

      // Motivo continua presente na base cadastral
      assert.ok(appContext.cancelReasons.some(r => r.id === 'cr-2'));
    });

    test('4.2 Renomear motivo não corrompe referências ou auditoria existente', () => {
      let appContext;
      function Consumer() {
        appContext = useApp();
        return null;
      }

      renderWithProvider(React.createElement(Consumer), 'marcos');

      const target = appContext.cancelReasons[1];
      const prevName = target.name;
      const newName = 'Queda severa de energia no bairro';

      act(() => {
        const res = appContext.updateCancelReason(target.id, newName);
        assert.equal(res.success, true);
      });

      // Auditoria registra a alteração
      const lastAudit = appContext.auditLogs[0];
      assert.equal(lastAudit.action, 'Alteração de Motivo');
      assert.match(lastAudit.details, new RegExp(prevName));
      assert.match(lastAudit.details, new RegExp(newName));
    });
  });

  describe('5. Interface de Administração (AdminView)', () => {
    test('5.1 Renderiza lista com contador de ativos e controles de edição/desativação', () => {
      let renderer;
      act(() => {
        renderer = renderWithProvider(React.createElement(AdminView), 'marcos');
      });

      // Clica na aba de motivos
      const tabs = renderer.root.findAllByProps({ className: 'admin-tab-btn ' });
      const reasonsTab = tabs.find(t => t.children.some(c => typeof c === 'string' && c.includes('Motivos de Cancelamento')));
      assert.ok(reasonsTab, 'Aba de motivos de cancelamento deve existir');

      act(() => {
        reasonsTab.props.onClick();
      });

      // Formulário presente
      const input = renderer.root.findByProps({ id: 'new-cancel-reason-input' });
      assert.ok(input);
      assert.equal(input.props.maxLength, 120);

      const addBtn = renderer.root.findByProps({ id: 'btn-add-cancel-reason' });
      assert.ok(addBtn);

      // Primeiro item da lista
      const editBtn = renderer.root.findByProps({ id: 'btn-edit-reason-0' });
      const toggleBtn = renderer.root.findByProps({ id: 'btn-toggle-reason-0' });
      const deleteBtn = renderer.root.findByProps({ id: 'btn-delete-reason-0' });

      assert.ok(editBtn);
      assert.ok(toggleBtn);
      assert.ok(deleteBtn);
    });
  });

  after(() => {
    if (currentRenderer) {
      try {
        act(() => currentRenderer.unmount());
      } catch {}
      currentRenderer = null;
    }
  });
});
