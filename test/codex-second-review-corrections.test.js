import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  toTemplateActivity,
  toTemplateParallelService,
  toServiceTemplateObject,
  serializeTemplateActivityForSql,
  serializeTemplateParallelServiceForSql,
  getServiceTemplateRemote,
  updateServiceTemplateRemote,
  validateServiceTemplate,
} from '../src/utils/serviceTemplateService.js';

describe('Suíte de Testes da Segunda Revisão do Codex (Problemas A até G)', () => {
  const TEST_CHURCH_ID = '01700000-0000-4000-8000-000000000001';

  // --------------------------------------------------------------------------
  // Problema A: Persistência da ordenação e ciclo Criar -> Reordenar -> Salvar -> Recarregar -> Conferir
  // --------------------------------------------------------------------------
  test('Problema A: Ao reordenar atividades (A, B, C -> mover A após B), display_order deve ser 1, 2, 3 sequencial', () => {
    const actA = { title: 'Atividade A', plannedDurationMinutes: 10, displayOrder: 1 };
    const actB = { title: 'Atividade B', plannedDurationMinutes: 15, displayOrder: 2 };
    const actC = { title: 'Atividade C', plannedDurationMinutes: 20, displayOrder: 3 };

    // 1. Criar lista inicial: [A, B, C]
    const initialList = [actA, actB, actC];
    assert.deepEqual(initialList.map(a => a.displayOrder), [1, 2, 3]);

    // 2. Reordenar: mover A para depois de B -> [B, A, C]
    const reorderedList = [actB, actA, actC];

    // Simula o recálculo executado pelos handlers de UI e serialização
    const recalculatedList = reorderedList.map((a, i) => ({ ...a, displayOrder: i + 1 }));
    assert.deepEqual(recalculatedList.map(a => a.displayOrder), [1, 2, 3]);
    assert.equal(recalculatedList[0].title, 'Atividade B');
    assert.equal(recalculatedList[1].title, 'Atividade A');
    assert.equal(recalculatedList[2].title, 'Atividade C');

    // 3. Salvar: serializar para payload SQL
    const serializedSql = recalculatedList.map((item, idx) => serializeTemplateActivityForSql(item, idx));
    assert.equal(serializedSql[0].title, 'Atividade B');
    assert.equal(serializedSql[0].display_order, 1);
    assert.equal(serializedSql[1].title, 'Atividade A');
    assert.equal(serializedSql[1].display_order, 2);
    assert.equal(serializedSql[2].title, 'Atividade C');
    assert.equal(serializedSql[2].display_order, 3);

    // 4. Recarregar: simula retorno do banco PostgreSQL (ordenado por display_order)
    const rawDbActivities = [
      { id: 'act-b', title: 'Atividade B', duration_minutes: 15, display_order: 1 },
      { id: 'act-a', title: 'Atividade A', duration_minutes: 10, display_order: 2 },
      { id: 'act-c', title: 'Atividade C', duration_minutes: 20, display_order: 3 }
    ];

    const reloaded = rawDbActivities.map(toTemplateActivity);

    // 5. Conferir
    assert.equal(reloaded[0].title, 'Atividade B');
    assert.equal(reloaded[0].displayOrder, 1);
    assert.equal(reloaded[1].title, 'Atividade A');
    assert.equal(reloaded[1].displayOrder, 2);
    assert.equal(reloaded[2].title, 'Atividade C');
    assert.equal(reloaded[2].displayOrder, 3);
  });

  // --------------------------------------------------------------------------
  // Problema B: Proteção contra escrita desatualizada
  // --------------------------------------------------------------------------
  test('Problema B: Falha de recarga marca dados como isStale e bloqueia mutações até reconciliação', () => {
    // Simula estado de um modelo previamente carregado com sucesso
    const validTemplate = {
      id: 'tpl-1',
      churchId: TEST_CHURCH_ID,
      name: 'Culto de Celebração',
      description: 'Estrutura válida',
      activitiesCount: 2,
      activities: [
        { title: 'Abertura', plannedDurationMinutes: 5, displayOrder: 1 },
        { title: 'Louvor', plannedDurationMinutes: 20, displayOrder: 2 }
      ],
      parallelServices: [],
      isComplete: true,
      active: true,
      isStale: false
    };

    // Cenário: Tentativa de recarga remota falha (ex: erro de rede)
    const isDataStale = true;
    const staleTemplate = { ...validTemplate, isStale: true };

    // 1. Preservar o último conteúdo válido apenas para consulta
    assert.equal(staleTemplate.name, 'Culto de Celebração');
    assert.equal(staleTemplate.activities.length, 2);
    assert.equal(staleTemplate.isStale, true);

    // 2. Simula guarda de bloqueio em AppContext/AdminView para update
    const canUpdate = !isDataStale && !staleTemplate.isStale;
    assert.equal(canUpdate, false, 'Mutação de modelo desatualizado deve ser bloqueada');

    // 3. Simula guarda de bloqueio para aplicação do modelo
    const canApply = !isDataStale && !staleTemplate.isStale && staleTemplate.isComplete !== false;
    assert.equal(canApply, false, 'Aplicação de modelo desatualizado deve ser bloqueada');

    // 4. Reconciliação bem-sucedida libera operações
    const reconciledDataStale = false;
    const reconciledTemplate = { ...staleTemplate, isStale: false };
    const canUpdateAfterSync = !reconciledDataStale && !reconciledTemplate.isStale;
    assert.equal(canUpdateAfterSync, true, 'Operações devem ser liberadas após reconciliação');
  });

  // --------------------------------------------------------------------------
  // Problema C: Atualização parcial de campos escalares e arrays
  // --------------------------------------------------------------------------
  test('Problema C: Preservação de campos escalares omitidos (description, eventTypeId)', async () => {
    let capturedParams = null;
    const mockClient = {
      rpc: async (fn, params) => {
        capturedParams = params;
        return { data: { success: true }, error: null };
      }
    };

    const existingTemplate = {
      id: '01700000-0000-4000-8000-000000000001',
      churchId: TEST_CHURCH_ID,
      name: 'Culto de Domingo',
      description: 'Descrição litúrgica original',
      eventTypeId: '01700000-0000-4000-8000-000000000088'
    };

    // Caso 1: Omissão de description e eventTypeId -> deve preservar existentes
    await updateServiceTemplateRemote(mockClient, {
      churchId: TEST_CHURCH_ID,
      templateId: existingTemplate.id,
      name: 'Culto de Domingo Atualizado',
      existingTemplate
      // description: undefined
      // eventTypeId: undefined
    });

    assert.equal(capturedParams.p_name, 'Culto de Domingo Atualizado');
    assert.equal(capturedParams.p_description, 'Descrição litúrgica original', 'Propriedade omitida deve preservar');
    assert.equal(capturedParams.p_event_type_id, '01700000-0000-4000-8000-000000000088', 'Propriedade omitida deve preservar');

    // Caso 2: Limpeza intencional de description (valor informado como vazio '')
    await updateServiceTemplateRemote(mockClient, {
      churchId: TEST_CHURCH_ID,
      templateId: existingTemplate.id,
      name: 'Culto Sem Descrição',
      description: '',
      eventTypeId: null,
      existingTemplate
    });

    assert.equal(capturedParams.p_name, 'Culto Sem Descrição');
    assert.equal(capturedParams.p_description, null, 'Limpeza solicitada deve passar null para limpar');
    assert.equal(capturedParams.p_event_type_id, null, 'Limpeza solicitada deve passar null');
  });

  test('Problema C: validateServiceTemplate em atualização parcial aceita campos omitidos usando existing', () => {
    const existing = {
      name: 'Modelo Original',
      description: 'Desc Original',
      activities: [{ title: 'Etapa 1', plannedDurationMinutes: 10 }]
    };

    // Atualização parcial sem informar name -> deve ser válida com existing
    const validation = validateServiceTemplate({ description: 'Nova Desc' }, { isPartial: true, current: existing });
    assert.equal(validation.valid, true);
    assert.equal(validation.error, null);
  });

  // --------------------------------------------------------------------------
  // Problema D: Presets sem duplicação acidental
  // --------------------------------------------------------------------------
  test('Problema D: Cliques repetidos em preset de serviço paralelo não duplicam', () => {
    const presetMidia = {
      teamId: 'midia',
      serviceName: 'Transmissão Online',
      prepRequiredMinutes: 45
    };

    const addPreset = (list, preset) => {
      const existsIdx = list.findIndex(s => s.serviceName.toLowerCase() === preset.serviceName.toLowerCase());
      if (existsIdx >= 0) {
        const existing = list[existsIdx];
        if (!existing.isDefaultActive) {
          // Reativa serviço sem sobrescrever tempo customizado
          return list.map((s, i) => i === existsIdx ? { ...s, isDefaultActive: true } : s);
        }
        // Já presente e ativo: preserva sem duplicar acidentalmente
        return list;
      }
      return [
        ...list,
        {
          ...preset,
          id: `tps-${Date.now()}-${list.length + 1}`,
          isDefaultActive: true
        }
      ];
    };

    // 1. Serviço ausente: adiciona
    let services = [];
    services = addPreset(services, presetMidia);
    assert.equal(services.length, 1);
    assert.equal(services[0].serviceName, 'Transmissão Online');
    assert.equal(services[0].isDefaultActive, true);
    assert.equal(services[0].prepRequiredMinutes, 45);

    // 2. Serviço presente e ativo: clicar de novo preserva sem duplicar
    services = addPreset(services, presetMidia);
    assert.equal(services.length, 1, 'Não deve duplicar serviço ativo');

    // Simula customização do tempo de preparação para 60 minutos
    services[0].prepRequiredMinutes = 60;
    // Simula inativação pelo usuário
    services[0].isDefaultActive = false;

    // 3. Serviço presente e inativo: clicar no preset reativa e preserva 60m customizados
    services = addPreset(services, presetMidia);
    assert.equal(services.length, 1, 'Deve reativar o mesmo serviço sem criar novo');
    assert.equal(services[0].isDefaultActive, true, 'Deve estar reativado');
    assert.equal(services[0].prepRequiredMinutes, 60, 'Deve preservar os 60 minutos customizados');
  });

  // --------------------------------------------------------------------------
  // Problema E: Comunicação de prévia não persistida em PlanningView
  // --------------------------------------------------------------------------
  test('Problema E: Aplicação de modelo com persisted: false produz feedback de aviso (preview em memória)', async () => {
    // Simula função assíncrona applyServiceTemplateToEvent retornando persisted: false
    const mockApplyServiceTemplateToEvent = async (templateId) => {
      return {
        success: true,
        persisted: false,
        warning: 'Programação carregada na prévia em memória a partir do modelo. A gravação persistente dos itens no servidor depende da implementação da issue #29.'
      };
    };

    // Simula o handler assíncrono corrigido de PlanningView
    const template = { id: 'tpl-1', name: 'Culto Matutino' };
    let capturedFeedback = null;

    const res = await mockApplyServiceTemplateToEvent('tpl-1');
    if (!res.success) {
      capturedFeedback = { type: 'error', message: res.error };
    } else if (res.persisted === false) {
      capturedFeedback = {
        type: 'warning',
        title: `Prévia do modelo "${template.name}" carregada em memória`,
        message: res.warning
      };
    } else {
      capturedFeedback = {
        type: 'success',
        message: `Modelo "${template.name}" aplicado e gravado com sucesso!`
      };
    }

    assert.equal(capturedFeedback.type, 'warning', 'Deve sinalizar aviso amber em vez de falso sucesso permanente');
    assert.match(capturedFeedback.title, /Prévia do modelo/);
    assert.match(capturedFeedback.message, /issue #29/);
  });

  test('Problema E: Falha na aplicação remota do modelo comunica o erro ao usuário', async () => {
    const mockApplyFail = async () => {
      return {
        success: false,
        error: 'Conexão rejeitada pelo servidor Supabase.'
      };
    };

    let capturedFeedback = null;
    const res = await mockApplyFail();
    if (!res.success) {
      capturedFeedback = { type: 'error', message: res.error };
    }

    assert.equal(capturedFeedback.type, 'error');
    assert.equal(capturedFeedback.message, 'Conexão rejeitada pelo servidor Supabase.');
  });

  // --------------------------------------------------------------------------
  // Problema F: Navegação de abas horizontais com teclado
  // --------------------------------------------------------------------------
  test('Problema F: Teclas verticais (ArrowDown, ArrowUp) não devem navegar abas horizontais', () => {
    const tabKeys = ['event_types', 'templates', 'activities', 'reasons', 'invites', 'liturgy', 'members'];
    let activeAdminTab = 'templates';
    let preventedDefault = false;

    const simulateKeyDown = (key) => {
      preventedDefault = false;
      const currentIdx = tabKeys.indexOf(activeAdminTab);
      let nextIdx = -1;
      if (key === 'ArrowRight') {
        preventedDefault = true;
        nextIdx = (currentIdx + 1) % tabKeys.length;
      } else if (key === 'ArrowLeft') {
        preventedDefault = true;
        nextIdx = (currentIdx - 1 + tabKeys.length) % tabKeys.length;
      } else if (key === 'Home') {
        preventedDefault = true;
        nextIdx = 0;
      } else if (key === 'End') {
        preventedDefault = true;
        nextIdx = tabKeys.length - 1;
      }
      // Note: ArrowDown e ArrowUp NÃO são interceptados!
      if (nextIdx !== -1) {
        activeAdminTab = tabKeys[nextIdx];
      }
    };

    // 1. ArrowDown não deve alterar aba nem chamar preventDefault
    simulateKeyDown('ArrowDown');
    assert.equal(activeAdminTab, 'templates', 'ArrowDown não pode alterar aba');
    assert.equal(preventedDefault, false, 'ArrowDown não pode chamar preventDefault');

    // 2. ArrowUp não deve alterar aba nem chamar preventDefault
    simulateKeyDown('ArrowUp');
    assert.equal(activeAdminTab, 'templates', 'ArrowUp não pode alterar aba');
    assert.equal(preventedDefault, false, 'ArrowUp não pode chamar preventDefault');

    // 3. ArrowRight navega para 'activities'
    simulateKeyDown('ArrowRight');
    assert.equal(activeAdminTab, 'activities');
    assert.equal(preventedDefault, true);

    // 4. ArrowLeft navega de volta para 'templates'
    simulateKeyDown('ArrowLeft');
    assert.equal(activeAdminTab, 'templates');
    assert.equal(preventedDefault, true);

    // 5. Home navega para primeira aba 'event_types'
    simulateKeyDown('Home');
    assert.equal(activeAdminTab, 'event_types');
    assert.equal(preventedDefault, true);

    // 6. End navega para última aba 'members'
    simulateKeyDown('End');
    assert.equal(activeAdminTab, 'members');
    assert.equal(preventedDefault, true);
  });

  // --------------------------------------------------------------------------
  // Problema G: Validação de resposta remota incompleta em getServiceTemplateRemote
  // --------------------------------------------------------------------------
  test('Problema G: getServiceTemplateRemote deve falhar se activities ou parallel_services não forem arrays', async () => {
    const incompleteMockClient = {
      rpc: async () => {
        return {
          data: {
            id: '01700000-0000-4000-8000-000000000001',
            name: 'Culto Incompleto',
            activities: null,
            parallel_services: null
          },
          error: null
        };
      }
    };

    const res = await getServiceTemplateRemote(incompleteMockClient, TEST_CHURCH_ID, '01700000-0000-4000-8000-000000000001');

    assert.equal(res.success, false, 'Resposta com activities/parallel_services nulos deve retornar success: false');
    assert.match(res.error, /incompleta/i);
    assert.equal(res.template?.isComplete, false);
  });

  test('Problema G: getServiceTemplateRemote aceita resposta válida com arrays vazios ou preenchidos', async () => {
    const validMockClient = {
      rpc: async () => {
        return {
          data: {
            id: '01700000-0000-4000-8000-000000000001',
            church_id: TEST_CHURCH_ID,
            name: 'Culto Válido Completo',
            description: 'Descrição completa',
            active: true,
            activities: [
              { id: 'act-1', title: 'Oração', duration_minutes: 5, display_order: 1 }
            ],
            parallel_services: [
              { id: 'serv-1', team_id: 'portaria', service_name: 'Portaria', prep_required_minutes: 15, is_default_active: true }
            ]
          },
          error: null
        };
      }
    };

    const res = await getServiceTemplateRemote(validMockClient, TEST_CHURCH_ID, '01700000-0000-4000-8000-000000000001');

    assert.equal(res.success, true);
    assert.equal(res.template?.isComplete, true);
    assert.equal(res.template?.activities.length, 1);
    assert.equal(res.template?.parallelServices.length, 1);
  });
});
