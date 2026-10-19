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
  calculateAvailableDurationMinutes,
  validateEventEdition,
  createEventEditionObject,
  reorderEventActivities,
  moveActivityUp,
  moveActivityDown,
  calculateProgramDurations,
  calculateParallelServiceWindow,
  checkScaleConflictWithParallelPrep,
  validateProgramPublication,
  publishEventProgram,
  saveEventProgramDraft,
  updateEventDurationPolicy,
  MAX_TITLE_LENGTH,
  MIN_TITLE_LENGTH,
  DEFAULT_TIMEZONE,
  DURATION_POLICIES,
  PROGRAM_STATUSES,
  MIN_EVENT_DURATION_MINUTES,
  MAX_EVENT_DURATION_MINUTES,
} from '../src/utils/eventPlanningService.js';

// Prepara bundle para teste de componentes React com AppContext
const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'event-planning-components.bundle.mjs');

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

// Mock do ambiente DOM global para Node.js
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

describe('Issue #28: Edição de Culto e Designação de Liderança de Liturgia (CA01 a CA04)', () => {
  const church = { id: 'church-sp-001', name: 'Igreja Central', timezone: 'America/Sao_Paulo' };
  const adminCaller = { id: 'admin-001', isAdmin: true, roles: ['admin'] };
  const volunteerCaller = { id: 'vol-001', isAdmin: false, roles: ['volunteer'] };

  test('CA01: Criação de edição vinculada à igreja com início/término e fuso oficial herdado', () => {
    const input = {
      title: 'Culto da Família - Edição Especial',
      type: 'Culto',
      plannedStartAt: '2026-10-25T19:00:00-03:00',
      plannedEndAt: '2026-10-25T21:00:00-03:00',
      durationPolicy: 'warn',
    };

    const validation = validateEventEdition(input, church, adminCaller);
    assert.equal(validation.valid, true);
    assert.equal(validation.plannedDurationMinutes, 120);
    assert.equal(validation.timezone, 'America/Sao_Paulo');

    const edition = createEventEditionObject(input, church, adminCaller);
    assert.equal(edition.churchId, 'church-sp-001');
    assert.equal(edition.timezone, 'America/Sao_Paulo');
    assert.equal(edition.title, 'Culto da Família - Edição Especial');
    assert.equal(edition.plannedDurationMinutes, 120);
    assert.equal(edition.status, 'pronto');
    assert.equal(edition.programStatus, 'draft');
    assert.equal(edition.durationPolicy, 'warn');
  });

  test('CA01: Suporte a culto com virada de meia-noite (cross-midnight / vigília)', () => {
    const input = {
      title: 'Vigília da Virada e Clamor',
      type: 'Vigília',
      plannedStartAt: '2026-12-31T22:00:00-03:00',
      plannedEndAt: '2027-01-01T04:00:00-03:00',
    };

    const durationCalc = calculateAvailableDurationMinutes(input.plannedStartAt, input.plannedEndAt);
    assert.equal(durationCalc.valid, true);
    // Das 22h às 04h = 6 horas = 360 minutos
    assert.equal(durationCalc.minutes, 360);

    const edition = createEventEditionObject(input, church, adminCaller);
    assert.equal(edition.plannedDurationMinutes, 360);
    assert.equal(new Date(edition.plannedStartAt).toISOString(), new Date('2026-12-31T22:00:00-03:00').toISOString());
    assert.equal(new Date(edition.plannedEndAt).toISOString(), new Date('2027-01-01T04:00:00-03:00').toISOString());
  });

  test('CA02: Designação de liderança de liturgia por administrador sem disparar execução nem atribuir voluntários', () => {
    const leaderId = 'vol-lucas-001';
    const input = {
      title: 'Culto de Ceia',
      plannedStartAt: '2026-11-01T10:00:00-03:00',
      plannedEndAt: '2026-11-01T12:00:00-03:00',
      liturgyLeaderId: leaderId,
    };

    // Administrador tem permissão para designar líder
    const validationAdmin = validateEventEdition(input, church, adminCaller);
    assert.equal(validationAdmin.valid, true);

    const edition = createEventEditionObject(input, church, adminCaller, [
      { id: 'act-1', title: 'Boas-Vindas', defaultDurationMinutes: 10 }
    ], [
      { id: 'serv-1', name: 'Recepção', prepRequiredMinutes: 20 }
    ]);

    assert.equal(edition.liturgyLeaderId, leaderId);
    // Garantias de negócio (CA02 e CA04): status inicial não inicia execução, voluntários não são atribuídos
    assert.equal(edition.status, 'pronto');
    assert.notEqual(edition.status, 'em_andamento');
    assert.notEqual(edition.status, 'encerrado');
    assert.equal(edition.activities[0].responsibleMemberId, null);
    assert.deepEqual(edition.activities[0].roster, []);
    assert.equal(edition.parallelServices[0].leaderId, null);
    assert.deepEqual(edition.parallelServices[0].volunteers, []);

    // Voluntário sem privilégio de administrador é bloqueado ao tentar designar líder
    const validationVol = validateEventEdition(input, church, volunteerCaller);
    assert.equal(validationVol.valid, false);
    assert.match(validationVol.error, /somente o administrador pode designar/i);
  });

  test('CA03: Bloqueio estrito de edições com intervalo inválido (término <= início)', () => {
    const invalidInterval = {
      title: 'Culto com Horário Invertido',
      plannedStartAt: '2026-10-25T21:00:00-03:00',
      plannedEndAt: '2026-10-25T19:00:00-03:00',
    };
    const res = validateEventEdition(invalidInterval, church, adminCaller);
    assert.equal(res.valid, false);
    assert.match(res.error, /deve ser posterior ao início/i);
  });

  test('CA03: Bloqueio de título vazio ou ausência de dados obrigatórios', () => {
    const emptyTitle = {
      title: '   ',
      plannedStartAt: '2026-10-25T19:00:00-03:00',
      plannedEndAt: '2026-10-25T21:00:00-03:00',
    };
    const resTitle = validateEventEdition(emptyTitle, church, adminCaller);
    assert.equal(resTitle.valid, false);
    assert.match(resTitle.error, /título do evento é obrigatório/i);
  });

  test('CA04: Isolamento de dados entre diferentes edições da igreja', () => {
    const edition1 = createEventEditionObject(
      {
        title: 'Culto Matutino',
        plannedStartAt: '2026-10-25T09:00:00-03:00',
        plannedEndAt: '2026-10-25T11:00:00-03:00',
        liturgyLeaderId: 'leader-a',
      },
      { id: 'church-sp-001', timezone: 'America/Sao_Paulo' },
      adminCaller
    );

    const edition2 = createEventEditionObject(
      {
        title: 'Culto Noturno Manaus',
        plannedStartAt: '2026-10-25T18:00:00-04:00',
        plannedEndAt: '2026-10-25T20:30:00-04:00',
        liturgyLeaderId: 'leader-b',
      },
      { id: 'church-am-002', timezone: 'America/Manaus' },
      adminCaller
    );

    assert.notEqual(edition1.id, edition2.id);
    assert.equal(edition1.timezone, 'America/Sao_Paulo');
    assert.equal(edition2.timezone, 'America/Manaus');
    assert.equal(edition1.liturgyLeaderId, 'leader-a');
    assert.equal(edition2.liturgyLeaderId, 'leader-b');
  });
});

describe('Issue #29: Programação Principal e Serviços Paralelos de Apoio (CA01 a CA04)', () => {
  const activities = [
    { id: 'act-1', title: 'Prelúdio Instrumental', plannedDurationMinutes: 10 },
    { id: 'act-2', title: 'Oração de Abertura', plannedDurationMinutes: 5 },
    { id: 'act-3', title: 'Louvor Congregacional', plannedDurationMinutes: 30 },
    { id: 'act-4', title: 'Mensagem Pastoral', plannedDurationMinutes: 40 },
    { id: 'act-5', title: 'Bênção Apostólica', plannedDurationMinutes: 5 },
  ];

  test('CA01: Reordenação contígua da sequência litúrgica (mover para cima e para baixo)', () => {
    // Reordena movendo act-4 (Mensagem) para cima (posição de Louvor)
    const movedUp = moveActivityUp(activities, 'act-4');
    assert.equal(movedUp[2].id, 'act-4');
    assert.equal(movedUp[3].id, 'act-3');

    // Reordena movendo act-1 (Prelúdio) para baixo
    const movedDown = moveActivityDown(activities, 'act-1');
    assert.equal(movedDown[0].id, 'act-2');
    assert.equal(movedDown[1].id, 'act-1');

    // Reordenação por índices genéricos
    const reordered = reorderEventActivities(activities, 0, 4);
    assert.equal(reordered[4].id, 'act-1');
    assert.equal(reordered[0].id, 'act-2');
  });

  test('CA02: Configuração de serviços paralelos com antecedência de preparação (prepRequiredMinutes)', () => {
    const eventPlannedStart = '2026-10-25T19:00:00-03:00';
    const eventPlannedEnd = '2026-10-25T21:00:00-03:00';
    const prepRequiredMinutes = 30;

    const windowCalculated = calculateParallelServiceWindow(
      eventPlannedStart,
      eventPlannedEnd,
      prepRequiredMinutes
    );

    assert.equal(windowCalculated.prepRequiredMinutes, 30);
    // Início da preparação 30 min antes: 18:30
    assert.equal(new Date(windowCalculated.prepStartAt).toISOString(), new Date('2026-10-25T18:30:00-03:00').toISOString());
    // Término coincide com o encerramento do culto: 21:00
    assert.equal(new Date(windowCalculated.eventEndAt).toISOString(), new Date('2026-10-25T21:00:00-03:00').toISOString());
    assert.equal(windowCalculated.totalOccupiedMinutes, 150); // 120 min de culto + 30 min de prep
  });

  test('CA03: Duração de bloco de apoio paralelo não infla a duração da liturgia principal', () => {
    const eventWithParallel = {
      plannedDurationMinutes: 120,
      activities: [
        { id: 'act-1', plannedDurationMinutes: 15 },
        { id: 'act-2', plannedDurationMinutes: 45 },
        { id: 'act-3', plannedDurationMinutes: 30 },
        // Item classificado como apoio paralelo (não soma na sequência principal)
        { id: 'act-support', plannedDurationMinutes: 60, isParallelSupport: true },
      ],
      parallelServices: [
        { id: 'serv-infantil', name: 'Ministério Infantil', prepRequiredMinutes: 20 },
      ]
    };

    const durations = calculateProgramDurations(eventWithParallel);
    // Soma esperada: 15 + 45 + 30 = 90 minutos (o apoio paralelo de 60 min é ignorado)
    assert.equal(durations.occupiedMinutes, 90);
    assert.equal(durations.availableMinutes, 120);
    assert.equal(durations.remainingMinutes, 30);
    assert.equal(durations.overflowMinutes, 0);
  });

  test('CA04: Detecção de conflito de escala considerando a janela de preparação do serviço paralelo', () => {
    const event = {
      plannedStartAt: '2026-10-25T19:00:00-03:00',
      plannedEndAt: '2026-10-25T21:00:00-03:00',
      parallelServices: [
        {
          id: 'serv-recepcao',
          name: 'Equipe de Boas-Vindas',
          volunteers: ['vol-joao-01'],
          prepRequiredMinutes: 30, // 18:30 às 21:00
        }
      ]
    };

    // Candidato a ensaio ou escala das 18:00 às 18:45 (colide com a prep das 18:30 às 21:00)
    const candidateWindowOverlap = {
      startAt: '2026-10-25T18:00:00-03:00',
      endAt: '2026-10-25T18:45:00-03:00',
    };

    const check1 = checkScaleConflictWithParallelPrep('vol-joao-01', candidateWindowOverlap, event);
    assert.equal(check1.hasConflict, true);
    assert.match(check1.reason, /ocupação com preparação antecedente/i);

    // Candidato a escala terminando às 18:20 (sem sobreposição com a preparação das 18:30)
    const candidateWindowNoOverlap = {
      startAt: '2026-10-25T17:00:00-03:00',
      endAt: '2026-10-25T18:20:00-03:00',
    };

    const check2 = checkScaleConflictWithParallelPrep('vol-joao-01', candidateWindowNoOverlap, event);
    assert.equal(check2.hasConflict, false);
  });
});

describe('Issue #30: Conferência de Duração e Publicação da Programação (CA01 a CA04)', () => {
  const overflownEvent = {
    id: 'evt-overflown',
    title: 'Culto Noturno Prolongado',
    plannedDurationMinutes: 90,
    durationPolicy: 'warn',
    programStatus: 'draft',
    programVersion: 1,
    activities: [
      { id: 'act-1', plannedDurationMinutes: 20 },
      { id: 'act-2', plannedDurationMinutes: 40 },
      { id: 'act-3', plannedDurationMinutes: 45 }, // Total = 105 min (> 90 min)
    ],
  };

  test('CA01: Cálculo de métricas de duração (disponível, ocupada, saldo e excedente)', () => {
    const metrics = calculateProgramDurations(overflownEvent);

    assert.equal(metrics.availableMinutes, 90);
    assert.equal(metrics.occupiedMinutes, 105);
    assert.equal(metrics.overflowMinutes, 15);
    assert.equal(metrics.remainingMinutes, 0);
  });

  test('CA02: Política "warn" permite publicação com estouro de tempo, emitindo aviso', () => {
    const eventWarn = { ...overflownEvent, durationPolicy: 'warn' };
    const check = validateProgramPublication(eventWarn);

    assert.equal(check.canPublish, true);
    assert.equal(check.policy, 'warn');
    assert.equal(check.overflowMinutes, 15);
    assert.match(check.warning, /excede o culto em 15 min.*política de alerta/i);

    const published = publishEventProgram(eventWarn, 'admin-001');
    assert.equal(published.programStatus, 'published');
    assert.equal(published.programVersion, 2);
    assert.equal(published.publishedByMemberId, 'admin-001');
    assert.ok(published.publishedAt);
  });

  test('CA03: Política "block" impede estritamente a publicação se houver estouro de tempo', () => {
    const eventBlock = { ...overflownEvent, durationPolicy: 'block' };
    const check = validateProgramPublication(eventBlock);

    assert.equal(check.canPublish, false);
    assert.equal(check.policy, 'block');
    assert.match(check.error, /modo de bloqueio \(block\), a programação não pode ser publicada/i);

    assert.throws(
      () => publishEventProgram(eventBlock, 'admin-001'),
      /modo de bloqueio/i
    );
  });

  test('CA03: Política "block" permite salvar rascunho mesmo com estouro de tempo', () => {
    const eventBlock = { ...overflownEvent, durationPolicy: 'block' };
    const draft = saveEventProgramDraft(eventBlock);

    assert.equal(draft.programStatus, 'draft');
    assert.ok(draft.lastSyncTimestamp);
  });

  test('CA04: Registro da política de duração e atualização por liderança autorizada', () => {
    const updated = updateEventDurationPolicy(overflownEvent, 'block', true);
    assert.equal(updated.durationPolicy, 'block');

    // Bloqueia alteração se o usuário não for autorizado
    assert.throws(
      () => updateEventDurationPolicy(overflownEvent, 'block', false),
      /somente liderança autorizada/i
    );
  });
});

describe('Integração de Estado e Componentes React (AppContext, PlanningView, AdminView)', () => {
  test('AppContext: Gerencia criação de edição, reordenação de atividades e política de duração', () => {
    let contextValue;

    function TestConsumer() {
      contextValue = useApp();
      return React.createElement('div', { id: 'test-node' }, 'Loaded');
    }

    TestRenderer.create(
      React.createElement(AppProvider, { initialUserId: 'marcos' }, React.createElement(TestConsumer, null))
    );

    assert.ok(contextValue.events, 'Lista de eventos deve existir no contexto');
    assert.ok(contextValue.currentEventId, 'currentEventId deve existir no contexto');
    assert.ok(typeof contextValue.createEventEdition === 'function');
    assert.ok(typeof contextValue.reorderActivities === 'function');
    assert.ok(typeof contextValue.moveActivityUpInEvent === 'function');
    assert.ok(typeof contextValue.moveActivityDownInEvent === 'function');
    assert.ok(typeof contextValue.setEventDurationPolicy === 'function');
    assert.ok(typeof contextValue.publishCurrentProgram === 'function');
    assert.ok(typeof contextValue.saveCurrentProgramDraft === 'function');

    // Testa criação de nova edição via AppContext
    let newCreatedId;
    act(() => {
      const res = contextValue.createEventEdition({
        title: 'Culto de Quinta - Teste Context',
        plannedStartAt: '2026-10-29T19:30:00-03:00',
        plannedEndAt: '2026-10-29T21:00:00-03:00',
        activities: [
          { id: 'act-ctx-1', title: 'Abertura', plannedDurationMinutes: 10 },
          { id: 'act-ctx-2', title: 'Louvor', plannedDurationMinutes: 20 },
        ],
      });
      assert.equal(res.success, true);
      newCreatedId = res.event.id;
    });

    const created = contextValue.events.find((e) => e.id === newCreatedId);
    assert.ok(created);
    assert.equal(created.title, 'Culto de Quinta - Teste Context');
    assert.equal(created.plannedDurationMinutes, 90);
    assert.equal(created.durationPolicy, 'warn');

    // Testa alteração de política para 'block'
    act(() => {
      contextValue.setEventDurationPolicy('block', newCreatedId);
    });
    const updated = contextValue.events.find((e) => e.id === newCreatedId);
    assert.equal(updated.durationPolicy, 'block');

    // Testa reordenação
    act(() => {
      contextValue.moveActivityDownInEvent('act-ctx-1', newCreatedId);
    });
    const reorderedEvt = contextValue.events.find((e) => e.id === newCreatedId);
    assert.equal(reorderedEvt.activities[0].id, 'act-ctx-2');
    assert.equal(reorderedEvt.activities[1].id, 'act-ctx-1');
  });

  test('PlanningView: Renderiza seletor de eventos, fuso horário, botões de reordenação e gauge de duração', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(AppProvider, null, React.createElement(PlanningView, null))
      );
    });

    const root = renderer.root;

    // Seletor de eventos e badges
    const eventSelect = root.findByProps({ id: 'select-current-event' });
    assert.ok(eventSelect, 'Seletor de evento deve estar visível no PlanningView');

    const tzBadge = root.findByProps({ id: 'badge-event-timezone' });
    assert.ok(tzBadge, 'Badge de fuso horário deve ser exibido');

    const statusBadge = root.findByProps({ id: 'badge-program-status' });
    assert.ok(statusBadge, 'Badge de status da programação deve ser exibido');

    // Botão de nova edição
    const btnNewEdition = root.findByProps({ id: 'btn-open-create-event-modal' });
    assert.ok(btnNewEdition, 'Botão de nova edição deve estar presente');

    // Botão de rascunho e publicar
    const btnDraft = root.findByProps({ id: 'btn-save-program-draft' });
    assert.ok(btnDraft, 'Botão de salvar rascunho deve estar presente');

    const btnPublish = root.findByProps({ id: 'btn-publish-program' });
    assert.ok(btnPublish, 'Botão de publicar programação deve estar presente');

    // Seletor de política
    const selectPolicy = root.findByProps({ id: 'select-duration-policy' });
    assert.ok(selectPolicy, 'Seletor de política de duração deve estar presente');
  });

  test('AdminView: Aba de Liturgia renderiza seletor de evento e designação de líder', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(AppProvider, { initialUserId: 'marcos' }, React.createElement(AdminView, null))
      );
    });

    const root = renderer.root;

    // Clica na aba de liturgia
    const liturgyTabBtn = root.findByProps({ id: 'tab-admin-liturgy' });
    assert.ok(liturgyTabBtn);
    act(() => {
      liturgyTabBtn.props.onClick();
    });

    // Encontra o seletor de edição de culto para liturgia
    const liturgyEventSelect = root.findByProps({ id: 'select-admin-liturgy-event' });
    assert.ok(liturgyEventSelect, 'Seletor de culto na aba de liturgia deve existir');

    // Encontra o botão de salvar designação
    const btnSaveDesignation = root.findByProps({ id: 'btn-save-admin-liturgy-designation' });
    assert.ok(btnSaveDesignation, 'Botão de salvar designação deve existir');
  });
});

describe('Validação de Artefatos Normativos e Migração SQL 023', () => {
  const rootDir = path.resolve(process.cwd());

  test('Documentação normativa docs/CADASTRO-PLANEJAMENTO-EVENTOS.md existe e cobre as 3 issues', () => {
    const docPath = path.join(rootDir, 'docs', 'CADASTRO-PLANEJAMENTO-EVENTOS.md');
    assert.ok(fs.existsSync(docPath), 'docs/CADASTRO-PLANEJAMENTO-EVENTOS.md deve existir');

    const content = fs.readFileSync(docPath, 'utf8');
    assert.match(content, /Issue #28/i);
    assert.match(content, /Issue #29/i);
    assert.match(content, /Issue #30/i);
    assert.match(content, /CA01/i);
    assert.match(content, /CA02/i);
    assert.match(content, /CA03/i);
    assert.match(content, /CA04/i);
    assert.match(content, /create_church_event_edition/i);
    assert.match(content, /reorder_event_items/i);
    assert.match(content, /set_event_duration_policy/i);
    assert.match(content, /publish_event_program/i);
  });

  test('Migração docs/sql/023_event_planning_and_durations.sql contém as 5 RPCs canônicas', () => {
    const sqlPath = path.join(rootDir, 'docs', 'sql', '023_event_planning_and_durations.sql');
    assert.ok(fs.existsSync(sqlPath), 'docs/sql/023_event_planning_and_durations.sql deve existir');

    const sql = fs.readFileSync(sqlPath, 'utf8');
    assert.match(sql, /create_church_event_edition/i);
    assert.match(sql, /reorder_event_items/i);
    assert.match(sql, /set_event_duration_policy/i);
    assert.match(sql, /publish_event_program/i);
    assert.match(sql, /save_event_program_draft/i);
    assert.match(sql, /SECURITY DEFINER/i);
  });

  test('Cenários de ensaio docs/sql/023_rehearsal_cases.sql contém casos P01 a P16 com ROLLBACK', () => {
    const rehearsalPath = path.join(rootDir, 'docs', 'sql', '023_rehearsal_cases.sql');
    assert.ok(fs.existsSync(rehearsalPath), 'docs/sql/023_rehearsal_cases.sql deve existir');

    const sql = fs.readFileSync(rehearsalPath, 'utf8');
    assert.match(sql, /P01/i);
    assert.match(sql, /P10/i);
    assert.match(sql, /P16/i);
    assert.match(sql, /ROLLBACK/i);
  });
});
