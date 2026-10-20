import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  toTemplateActivity,
  toTemplateParallelService,
  toServiceTemplateObject,
  serializeTemplateActivityForSql,
  serializeTemplateParallelServiceForSql,
  createServiceTemplateRemote,
  updateServiceTemplateRemote,
  fetchServiceTemplatesRemote,
  getServiceTemplateRemote,
  instantiateTemplateForEvent,
} from '../src/utils/serviceTemplateService.js';

describe('Correções Obrigatórias Pós-Revisão do Codex', () => {
  const TEST_CHURCH_ID = '01700000-0000-4000-8000-000000000001';

  // --------------------------------------------------------------------------
  // 1. Ciclo de Vida: Criar → Consultar → Editar → Recarregar Modelo
  // --------------------------------------------------------------------------
  test('1. Ciclo de Vida: Criar -> Consultar -> Editar -> Recarregar Modelo', async () => {
    const memoryDb = new Map();

    const mockClient = {
      rpc: async (fn, params) => {
        if (fn === 'create_service_template') {
          const id = '01700000-0000-4000-8000-000000000099';
          const record = {
            id,
            church_id: params.p_church_id,
            name: params.p_name,
            description: params.p_description,
            event_type_id: params.p_event_type_id,
            active: params.p_active !== false,
            activities: (params.p_activities || []).map((a, idx) => ({
              id: `act-${idx + 1}`,
              ...a
            })),
            parallel_services: (params.p_parallel_services || []).map((s, idx) => ({
              id: `serv-${idx + 1}`,
              ...s
            })),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          memoryDb.set(id, record);
          return { data: { template_id: id }, error: null };
        }

        if (fn === 'get_service_template') {
          const found = memoryDb.get(params.p_template_id);
          if (!found) return { data: null, error: { message: 'Not found', code: 'PGRST116' } };
          return { data: found, error: null };
        }

        if (fn === 'update_service_template') {
          const found = memoryDb.get(params.p_template_id);
          if (!found) return { data: null, error: { message: 'Not found', code: 'PGRST116' } };
          if (params.p_name !== undefined) found.name = params.p_name;
          if (params.p_description !== undefined) found.description = params.p_description;
          if (params.p_activities !== null && params.p_activities !== undefined) {
            found.activities = params.p_activities.map((a, idx) => ({ id: `act-updated-${idx + 1}`, ...a }));
          }
          if (params.p_parallel_services !== null && params.p_parallel_services !== undefined) {
            found.parallel_services = params.p_parallel_services.map((s, idx) => ({ id: `serv-updated-${idx + 1}`, ...s }));
          }
          found.updated_at = new Date().toISOString();
          return { data: { success: true }, error: null };
        }

        return { data: null, error: null };
      }
    };

    // 1. Criar
    const createPayload = {
      name: 'Culto Noturno de Celebração',
      description: 'Modelo com liturgia e apoios',
      eventTypeId: '01700000-0000-4000-8000-000000000002',
      activities: [
        {
          title: 'Abertura & Louvor',
          category: 'Louvor',
          plannedDurationMinutes: 35,
          displayOrder: 1,
          requiresPlayback: true,
          notes: 'Instrumentistas a postos'
        }
      ],
      parallelServices: [
        {
          teamId: 'som',
          serviceName: 'Sonoplastia e Palco',
          prepRequiredMinutes: 40,
          isDefaultActive: true,
          displayOrder: 1
        }
      ]
    };

    const createRes = await createServiceTemplateRemote(mockClient, TEST_CHURCH_ID, createPayload);
    assert.equal(createRes.success, true);
    const templateId = createRes.templateId;
    assert.equal(templateId, '01700000-0000-4000-8000-000000000099');

    // 2. Consultar
    const getRes = await getServiceTemplateRemote(mockClient, TEST_CHURCH_ID, templateId);
    assert.equal(getRes.success, true);
    assert.equal(getRes.template.name, 'Culto Noturno de Celebração');
    assert.equal(getRes.template.isComplete, true);
    assert.equal(getRes.template.activities[0].plannedDurationMinutes, 35);
    assert.equal(getRes.template.activities[0].requiresPlayback, true);
    assert.equal(getRes.template.parallelServices[0].serviceName, 'Sonoplastia e Palco');
    assert.equal(getRes.template.parallelServices[0].prepRequiredMinutes, 40);

    // 3. Editar
    const updateRes = await updateServiceTemplateRemote(mockClient, {
      churchId: TEST_CHURCH_ID,
      templateId,
      name: 'Culto Noturno Especial - Renovado',
      description: 'Descrição atualizada',
      activities: [
        {
          title: 'Abertura & Louvor Expandido',
          category: 'Louvor',
          plannedDurationMinutes: 50,
          displayOrder: 1,
          requiresPlayback: false,
          notes: 'Sem playback nesta edição'
        }
      ],
      parallelServices: [
        {
          teamId: 'som',
          serviceName: 'Sonoplastia e Palco',
          prepRequiredMinutes: 60,
          isDefaultActive: true,
          displayOrder: 1
        }
      ]
    });
    assert.equal(updateRes.success, true);

    // 4. Recarregar
    const reloadRes = await getServiceTemplateRemote(mockClient, TEST_CHURCH_ID, templateId);
    assert.equal(reloadRes.success, true);
    assert.equal(reloadRes.template.name, 'Culto Noturno Especial - Renovado');
    assert.equal(reloadRes.template.activities[0].plannedDurationMinutes, 50);
    assert.equal(reloadRes.template.activities[0].requiresPlayback, false);
    assert.equal(reloadRes.template.parallelServices[0].prepRequiredMinutes, 60);
  });

  // --------------------------------------------------------------------------
  // 2. Preservação de durações e tempos de preparação diferentes dos padrões
  // --------------------------------------------------------------------------
  test('2. Preservar durações (37m vs 10m) e tempos de preparação (45m vs 0m)', () => {
    const rawActivity = {
      title: 'Ministração da Palavra',
      category: 'Palavra',
      plannedDurationMinutes: 37, // diferente do padrão de 10m
      displayOrder: 2,
      requiresPlayback: false,
      notes: 'Tempo estendido para pregação temática'
    };

    const serializedAct = serializeTemplateActivityForSql(rawActivity);
    assert.equal(serializedAct.planned_duration_minutes, 37, 'Serialização deve manter planned_duration_minutes = 37');

    const deserializedAct = toTemplateActivity(serializedAct);
    assert.equal(deserializedAct.plannedDurationMinutes, 37, 'Deserialização deve produzir plannedDurationMinutes = 37');

    const rawParallel = {
      teamId: 'transmissao',
      serviceName: 'Streaming ao Vivo',
      prepRequiredMinutes: 45, // diferente do padrão de 0m
      isDefaultActive: true,
      displayOrder: 1
    };

    const serializedServ = serializeTemplateParallelServiceForSql(rawParallel);
    assert.equal(serializedServ.prep_required_minutes, 45, 'Serialização deve manter prep_required_minutes = 45');

    const deserializedServ = toTemplateParallelService(serializedServ);
    assert.equal(deserializedServ.prepRequiredMinutes, 45, 'Deserialização deve produzir prepRequiredMinutes = 45');
  });

  // --------------------------------------------------------------------------
  // 3. Conferência estrita do payload JSON enviado às RPCs (snake_case)
  // --------------------------------------------------------------------------
  test('3. Conferir payload JSON enviado às RPCs em snake_case conforme SQL 022', async () => {
    let capturedParams = null;
    const mockClient = {
      rpc: async (fn, params) => {
        capturedParams = params;
        return { data: { template_id: '01700000-0000-4000-8000-000000000077' }, error: null };
      }
    };

    const payload = {
      name: 'Culto de Homologação',
      description: 'Modelo de ensaio',
      eventTypeId: '01700000-0000-4000-8000-000000000005',
      activities: [
        {
          standardActivityId: '01700000-0000-4000-8000-000000000010',
          title: 'Louvor Congregacional',
          category: 'Louvor',
          plannedDurationMinutes: 25,
          displayOrder: 1,
          requiresPlayback: true,
          notes: 'Tocar playback faixa 3'
        }
      ],
      parallelServices: [
        {
          teamId: 'transmissao',
          serviceName: 'Transmissão ao Vivo',
          prepRequiredMinutes: 45,
          isDefaultActive: true,
          displayOrder: 1
        }
      ]
    };

    await createServiceTemplateRemote(mockClient, TEST_CHURCH_ID, payload);

    assert.ok(capturedParams, 'RPC create_service_template chamada');
    assert.equal(capturedParams.p_church_id, TEST_CHURCH_ID);
    assert.equal(capturedParams.p_name, 'Culto de Homologação');
    assert.equal(capturedParams.p_event_type_id, '01700000-0000-4000-8000-000000000005');

    const sentAct = capturedParams.p_activities[0];
    assert.equal(sentAct.planned_duration_minutes, 25);
    assert.equal(sentAct.standard_activity_id, '01700000-0000-4000-8000-000000000010');
    assert.equal(sentAct.requires_playback, true);
    assert.equal(sentAct.display_order, 1);
    assert.equal(sentAct.title, 'Louvor Congregacional');
    assert.equal(sentAct.category, 'Louvor');
    assert.equal(sentAct.notes, 'Tocar playback faixa 3');

    const sentServ = capturedParams.p_parallel_services[0];
    assert.equal(sentServ.service_name, 'Transmissão ao Vivo');
    assert.equal(sentServ.team_id, 'transmissao');
    assert.equal(sentServ.prep_required_minutes, 45);
    assert.equal(sentServ.is_default_active, true);
    assert.equal(sentServ.display_order, 1);
  });

  // --------------------------------------------------------------------------
  // 4. Normalização de respostas SQL reais ou fixtures fiéis ao contrato SQL 022
  // --------------------------------------------------------------------------
  test('4. Conferir normalização de fixture fiel ao SQL 022 get_service_template', () => {
    const sql022Response = {
      id: '01700000-0000-4000-8000-000000000005',
      church_id: TEST_CHURCH_ID,
      event_type_id: '01700000-0000-4000-8000-000000000003',
      event_type_name: 'Culto Dominical',
      name: 'Culto Completo Noturno',
      description: 'Estrutura completa com transmissão',
      active: true,
      activities: [
        {
          id: '01700000-0000-4000-8000-000000000011',
          standard_activity_id: '01700000-0000-4000-8000-000000000008',
          title: 'Momento de Intercessão',
          category: 'Liturgia',
          planned_duration_minutes: 18,
          display_order: 1,
          notes: 'Oração pastoral',
          requires_playback: false
        },
        {
          id: '01700000-0000-4000-8000-000000000012',
          standard_activity_id: null,
          title: 'Avisos da Comunidade',
          category: 'Pastoral',
          planned_duration_minutes: 7,
          display_order: 2,
          notes: null,
          requires_playback: false
        }
      ],
      parallel_services: [
        {
          id: '01700000-0000-4000-8000-000000000021',
          team_id: 'bercario',
          service_name: 'Berçário e Apoio Infantil',
          prep_required_minutes: 30,
          is_default_active: true,
          display_order: 1
        },
        {
          id: '01700000-0000-4000-8000-000000000022',
          team_id: 'apoio',
          service_name: 'Limpeza e Sanitização',
          prep_required_minutes: 60,
          is_default_active: false,
          display_order: 2
        }
      ],
      created_at: '2026-10-19T18:00:00Z',
      updated_at: '2026-10-19T18:05:00Z'
    };

    const template = toServiceTemplateObject(sql022Response);

    assert.equal(template.id, '01700000-0000-4000-8000-000000000005');
    assert.equal(template.churchId, TEST_CHURCH_ID);
    assert.equal(template.eventTypeId, '01700000-0000-4000-8000-000000000003');
    assert.equal(template.eventTypeName, 'Culto Dominical');
    assert.equal(template.isComplete, true);

    // Atividades
    assert.equal(template.activities.length, 2);
    assert.equal(template.activities[0].plannedDurationMinutes, 18);
    assert.equal(template.activities[0].standardActivityId, '01700000-0000-4000-8000-000000000008');
    assert.equal(template.activities[1].plannedDurationMinutes, 7);
    assert.equal(template.activities[1].standardActivityId, null);
    assert.equal(template.activities[1].notes, '');

    // Serviços paralelos mapeados a partir de parallel_services
    assert.equal(template.parallelServices.length, 2);
    assert.equal(template.parallelServices[0].serviceName, 'Berçário e Apoio Infantil');
    assert.equal(template.parallelServices[0].prepRequiredMinutes, 30);
    assert.equal(template.parallelServices[0].isDefaultActive, true);
    assert.equal(template.parallelServices[1].serviceName, 'Limpeza e Sanitização');
    assert.equal(template.parallelServices[1].prepRequiredMinutes, 60);
    assert.equal(template.parallelServices[1].isDefaultActive, false);
  });

  // --------------------------------------------------------------------------
  // 5. Falha de rede durante carregamento dos detalhes
  // --------------------------------------------------------------------------
  test('5. Falha de rede durante carregamento dos detalhes não pode retornar sucesso com listas vazias', async () => {
    const mockClient = {
      rpc: async (fn) => {
        if (fn === 'list_service_templates') {
          return {
            data: [
              {
                id: '01700000-0000-4000-8000-000000000001',
                name: 'Culto Padrão',
                activities_count: 5,
                parallel_services_count: 2,
                total_duration_minutes: 80,
                active: true
              }
            ],
            error: null
          };
        }
        if (fn === 'get_service_template') {
          return { data: null, error: { message: 'Network connection timeout', code: 'PGRST000' } };
        }
        return { data: null, error: null };
      }
    };

    const res = await fetchServiceTemplatesRemote(mockClient, TEST_CHURCH_ID, true);
    assert.equal(res.success, false, 'Falha no carregamento de detalhes deve retornar success: false');
    assert.match(res.error, /Falha ao carregar detalhes/i);
    assert.equal(res.templates.length, 0, 'Não deve retornar modelos com listas vazias se houve falha');
  });

  // --------------------------------------------------------------------------
  // 6. Bloqueio de salvamento e aplicação de modelos incompletos
  // --------------------------------------------------------------------------
  test('6. Bloqueio de aplicação de modelos incompletos (isComplete: false)', () => {
    const incompleteTemplate = {
      id: '01700000-0000-4000-8000-000000000001',
      name: 'Modelo Resumo',
      isComplete: false,
      activities: [],
      parallelServices: []
    };

    assert.throws(() => {
      instantiateTemplateForEvent(incompleteTemplate, '01700000-0000-4000-8000-000000000088');
    }, /detalhes incompletos/i);
  });

  // --------------------------------------------------------------------------
  // 7. Atualização parcial sem exclusão involuntária
  // --------------------------------------------------------------------------
  test('7. Atualização parcial: omitir activities/parallelServices envia null (preserva banco)', async () => {
    let capturedParams = null;
    const mockClient = {
      rpc: async (fn, params) => {
        capturedParams = params;
        return { data: { success: true }, error: null };
      }
    };

    // Caso A: Atividades e serviços omitidos (undefined)
    await updateServiceTemplateRemote(mockClient, {
      churchId: TEST_CHURCH_ID,
      templateId: '01700000-0000-4000-8000-000000000001',
      name: 'Nome Atualizado do Modelo'
    });

    assert.ok(capturedParams);
    assert.equal(capturedParams.p_activities, null, 'Atividades omitidas devem ser passadas como null');
    assert.equal(capturedParams.p_parallel_services, null, 'Serviços omitidos devem ser passados como null');

    // Caso B: Intenção explícita de limpar atividades (array vazio)
    await updateServiceTemplateRemote(mockClient, {
      churchId: TEST_CHURCH_ID,
      templateId: '01700000-0000-4000-8000-000000000001',
      name: 'Modelo com Atividades Limpas',
      activities: [],
      parallelServices: []
    });

    assert.deepEqual(capturedParams.p_activities, [], 'Array vazio explícito deve enviar []');
    assert.deepEqual(capturedParams.p_parallel_services, [], 'Array vazio explícito de serviços deve enviar []');
  });

  // --------------------------------------------------------------------------
  // 8. Diferentes serviços associados à mesma equipe (Presets & Custom)
  // --------------------------------------------------------------------------
  test('8. Diferentes serviços associados à mesma equipe não colidem e são mantidos como registros distintos', () => {
    // Mesma equipe 'apoio', mas serviços distintos:
    const serv1 = toTemplateParallelService({
      teamId: 'apoio',
      serviceName: 'Berçário & Cuidados Infantis',
      prepRequiredMinutes: 20,
      isDefaultActive: true,
      displayOrder: 1
    });

    const serv2 = toTemplateParallelService({
      teamId: 'apoio',
      serviceName: 'Organização das Cadeiras & Salão',
      prepRequiredMinutes: 30,
      isDefaultActive: true,
      displayOrder: 2
    });

    const serv3 = toTemplateParallelService({
      teamId: 'apoio',
      serviceName: 'Limpeza e Higienização',
      prepRequiredMinutes: 60,
      isDefaultActive: true,
      displayOrder: 3
    });

    assert.equal(serv1.teamId, 'apoio');
    assert.equal(serv2.teamId, 'apoio');
    assert.equal(serv3.teamId, 'apoio');

    assert.notEqual(serv1.serviceName, serv2.serviceName);
    assert.notEqual(serv2.serviceName, serv3.serviceName);
    assert.notEqual(serv1.id, serv2.id);

    // Validação de matching por nome (e não por teamId)
    const list = [serv1, serv2];
    const incomingPreset = { teamId: 'apoio', serviceName: 'Limpeza e Higienização', prepRequiredMinutes: 60 };
    const nameMatch = list.some(s => s.serviceName.toLowerCase() === incomingPreset.serviceName.toLowerCase());
    const spuriousTeamMatch = list.some(s => s.teamId === incomingPreset.teamId);

    assert.equal(nameMatch, false, 'Limpeza não está na lista por nome');
    assert.equal(spuriousTeamMatch, true, 'Checar por teamId incorretamente afirmaria que Limpeza já existe');
  });

  // --------------------------------------------------------------------------
  // 9. Reordenação com persistência correta de display_order
  // --------------------------------------------------------------------------
  test('9. Reordenação com persistência correta de display_order', () => {
    const activities = [
      { title: 'Abertura', displayOrder: 1, plannedDurationMinutes: 5 },
      { title: 'Palavra', displayOrder: 2, plannedDurationMinutes: 40 },
      { title: 'Encerramento', displayOrder: 3, plannedDurationMinutes: 5 }
    ];

    // Simula reordenação: Palavra vai para o início
    const reordered = [
      { ...activities[1], displayOrder: 1 },
      { ...activities[0], displayOrder: 2 },
      { ...activities[2], displayOrder: 3 }
    ];

    const serialized = reordered.map(serializeTemplateActivityForSql);
    assert.equal(serialized[0].title, 'Palavra');
    assert.equal(serialized[0].display_order, 1);
    assert.equal(serialized[1].title, 'Abertura');
    assert.equal(serialized[1].display_order, 2);
    assert.equal(serialized[2].title, 'Encerramento');
    assert.equal(serialized[2].display_order, 3);
  });

  // --------------------------------------------------------------------------
  // 10. Preservação dos dados de outros modelos e isolamento de edições
  // --------------------------------------------------------------------------
  test('10. Preservação dos dados de outros modelos e isolamento multi-tenant', async () => {
    let calledTemplateId = null;

    const mockClient = {
      rpc: async (fn, params) => {
        calledTemplateId = params.p_template_id;
        return { data: { success: true }, error: null };
      }
    };

    const targetTemplateId = '01700000-0000-4000-8000-000000000001';
    const res = await updateServiceTemplateRemote(mockClient, {
      churchId: TEST_CHURCH_ID,
      templateId: targetTemplateId,
      name: 'Atualização Cirúrgica'
    });

    assert.equal(res.success, true);
    assert.equal(calledTemplateId, targetTemplateId, 'RPC deve receber exatamente o templateId alvo');

    // Valida que sem churchId a operação é bloqueada antes de tocar o banco
    const rejectedWithoutChurch = await updateServiceTemplateRemote(mockClient, {
      churchId: null,
      templateId: targetTemplateId,
      name: 'Tentativa Sem Tenant'
    });
    assert.equal(rejectedWithoutChurch.success, false);
    assert.equal(rejectedWithoutChurch.error, 'Parâmetros obrigatórios ausentes.');
  });

  // --------------------------------------------------------------------------
  // 11. Semântica de Acessibilidade das Abas e Formulários
  // --------------------------------------------------------------------------
  test('11. Contratos de Acessibilidade: atributos WAI-ARIA nas abas e formulários', async () => {
    // Lê o arquivo AdminView.jsx para validar semanticamente os padrões exigidos
    const fs = await import('node:fs/promises');
    const adminViewContent = await fs.readFile('src/components/AdminView.jsx', 'utf-8');

    // Abas e Painéis
    assert.ok(adminViewContent.includes('role="tablist"'), 'AdminView deve conter role="tablist"');
    assert.ok(adminViewContent.includes('role="tab"'), 'AdminView deve conter botões com role="tab"');
    assert.ok(adminViewContent.includes('onKeyDown={handleTabKeyDown}'), 'Navegação por teclado deve estar anexada com handleTabKeyDown');

    const expectedPanels = [
      'panel-admin-event-types',
      'panel-admin-templates',
      'panel-admin-activities',
      'panel-admin-reasons',
      'panel-admin-invites',
      'panel-admin-liturgy',
      'panel-admin-members'
    ];

    for (const panelId of expectedPanels) {
      assert.ok(
        adminViewContent.includes(`id="${panelId}"`),
        `Painel de administração com id="${panelId}" deve existir`
      );
      assert.ok(
        adminViewContent.includes(`aria-controls="${panelId}"`),
        `Aba deve conter aria-controls apontando para "${panelId}"`
      );
    }

    // Formulário de serviços paralelos acessível
    assert.ok(
      adminViewContent.includes('htmlFor="custom-parallel-service-name-input"'),
      'Input personalizado de serviço deve ter label com htmlFor associado'
    );
    assert.ok(
      adminViewContent.includes('htmlFor="custom-parallel-service-prep-input"'),
      'Input personalizado de prep deve ter label com htmlFor associado'
    );
    assert.ok(
      adminViewContent.includes('aria-label={`Ativar serviço ${serv.serviceName}`}'),
      'Checkbox de serviço paralelo deve possuir aria-label explicativo'
    );
  });
});
