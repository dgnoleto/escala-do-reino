import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {
  calculateParallelServiceWindow,
  checkScaleConflictWithParallelPrep,
  calculateEditionScaleConflicts,
  getEventAssignmentsRemote,
} from '../src/utils/eventPlanningService.js';

const CHURCH_ID = '00000000-0000-4000-8000-000000000001';
const EVENT_ID = '00000000-0000-4000-8000-000000000099';

// Bundle JSX para testes integrados da tela real com AppContext
const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'issue-29-conflitos-tela-real.bundle.mjs');
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
const { AppProvider, useApp, PlanningView } = await import(pathToFileURL(bundlePath).href);

function getNodeText(node) {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join(' ');
  if (Array.isArray(node.children)) return node.children.map(getNodeText).join(' ');
  if (node.props?.children) return getNodeText(node.props.children);
  return '';
}

describe('Issue #29 (CA03 e CA04) — Conflitos de Escala com Preparação Antecedente na Tela Real', () => {
  test('Tela exibe sinal de conflito (quem, qual apoio, qual intervalo) sem bloquear nem substituir pessoas', async () => {
    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    let renderer = null;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AppProvider,
          null,
          React.createElement(
            React.Fragment,
            null,
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        )
      );
    });

    // Configura edição com apoio paralelo (Sonoplastia com 30 min de preparação) e voluntário Lucas alocado
    // Culto: 19:00 às 21:00 -> Ocupação do apoio: 18:30 às 21:00
    // Atividade: Louvor das 19:00 às 19:30 com Lucas também escalado no vocal
    await act(async () => {
      appCtx.setMembers([
        { id: 'vol-lucas-01', name: 'Lucas Ferreira', active: true, roles: ['membro'], skills: ['Sonoplastia', 'Canto'] },
        { id: 'vol-ana-02', name: 'Ana Souza', active: true, roles: ['membro'], skills: ['Dança'] },
      ]);
      appCtx.setEvents([{
        id: EVENT_ID,
        church_id: CHURCH_ID,
        title: 'Culto de Celebração com Apoios',
        status: 'scheduled',
        programStatus: 'draft',
        durationPolicy: 'warn',
        plannedStartAt: '2026-10-25T19:00:00-03:00',
        plannedEndAt: '2026-10-25T21:00:00-03:00',
        activitiesKnownInSession: true,
        parallelServices: [
          {
            id: 'serv-som-01',
            teamId: 'team-som',
            name: 'Sonoplastia',
            prepRequiredMinutes: 30, // 18:30 às 21:00
            volunteers: ['vol-lucas-01'],
          }
        ],
        activities: [
          {
            id: 'act-louvor-01',
            title: 'Momento de Louvor',
            category: 'Louvor',
            plannedDurationMinutes: 30,
            roster: [
              { memberId: 'vol-lucas-01', role: 'Vocal' }
            ],
          }
        ],
        assignments: [],
      }]);
      appCtx.setCurrentEventId(EVENT_ID);
    });

    const root = renderer.root;

    // 1. Painel de sinais de conflito presente na tela
    const panel = root.find(node => node.props.id === 'panel-edition-scale-conflicts');
    assert.ok(panel, 'Painel de sinais de conflito deve estar renderizado na tela');

    // 2. Quem: nome do voluntário exibido
    const memberNameNode = panel.find(node => node.props.className === 'conflict-member-name');
    assert.equal(memberNameNode.props.children, 'Lucas Ferreira');

    // 3. Qual apoio: nome do apoio e preparação antecedente
    const serviceNameNode = panel.find(node => node.props.className === 'conflict-service-name');
    assert.equal(serviceNameNode.props.children, 'Sonoplastia');

    // 4. Qual intervalo: intervalo de sobreposição
    const intervalNode = panel.find(node => node.props.className === 'conflict-interval');
    assert.ok(intervalNode.props.children.includes('19:00'), 'Deve exibir horário da sobreposição');

    // 5. Advertência clara de que é SINAL (não bloqueia nem substitui ninguém)
    const textContent = JSON.stringify(renderer.toJSON());
    assert.match(textContent, /sinais informativos/i);
    assert.match(textContent, /não bloqueiam a escala nem realizam substituições automáticas/i);

    // 6. Alocação permanece preservada (não substituiu nem removeu o voluntário)
    const currentEvent = appCtx.events.find(e => e.id === EVENT_ID);
    assert.equal(currentEvent.parallelServices[0].volunteers[0], 'vol-lucas-01');
    assert.equal(currentEvent.activities[0].roster[0].memberId, 'vol-lucas-01');
  });

  test('Sem horário final previsto (plannedEndAt null): não calcula conflito e não renderiza painel de conflito', async () => {
    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    let renderer = null;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AppProvider,
          null,
          React.createElement(
            React.Fragment,
            null,
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        )
      );
    });

    await act(async () => {
      appCtx.setEvents([{
        id: 'evt-sem-fim',
        church_id: CHURCH_ID,
        title: 'Culto Sem Horário Final',
        status: 'scheduled',
        plannedStartAt: '2026-10-25T19:00:00-03:00',
        plannedEndAt: null, // Sem fim previsto
        activitiesKnownInSession: true,
        parallelServices: [
          {
            id: 'serv-transmissao',
            name: 'Transmissão',
            prepRequiredMinutes: 20,
            volunteers: ['vol-lucas-01'],
          }
        ],
        activities: [
          {
            id: 'act-01',
            title: 'Louvor',
            plannedDurationMinutes: 20,
            roster: [{ memberId: 'vol-lucas-01', role: 'Vocal' }],
          }
        ],
        assignments: [],
      }]);
      appCtx.setCurrentEventId('evt-sem-fim');
    });

    const root = renderer.root;
    const panel = root.findAll(node => node.props.id === 'panel-edition-scale-conflicts');
    assert.equal(panel.length, 0, 'Sem plannedEndAt, NÃO deve renderizar painel de conflito');
  });

  test('Bloqueio Litúrgico do Louvor (M22) continua bloqueando e não muda de comportamento', async () => {
    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    let renderer = null;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AppProvider,
          null,
          React.createElement(
            React.Fragment,
            null,
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        )
      );
    });

    await act(async () => {
      appCtx.setMembers([
        { id: 'beatriz', name: 'Beatriz Costa', active: true, roles: ['membro'], skills: ['Canto', 'Dança'] },
      ]);
      appCtx.setEvents([{
        id: 'evt-m22',
        church_id: CHURCH_ID,
        title: 'Culto com Louvor M22',
        status: 'scheduled',
        plannedStartAt: '2026-10-25T19:00:00-03:00',
        plannedEndAt: '2026-10-25T21:00:00-03:00',
        activitiesKnownInSession: true,
        parallelServices: [],
        activities: [
          {
            id: 'act-louvor-m22',
            title: 'Louvor Central',
            category: 'Louvor',
            plannedDurationMinutes: 25,
            roster: [
              { memberId: 'beatriz', role: 'Dança' }
            ],
          }
        ],
      }]);
      appCtx.setCurrentEventId('evt-m22');
    });

    const root = renderer.root;

    // Clica no botão Testar Conflito (M22)
    const btnM22 = root.find(node =>
      node.props.className &&
      node.props.className.includes('btn-warning') &&
      node.props.children === 'Testar Conflito (M22)'
    );
    assert.ok(btnM22, 'Botão Testar Conflito (M22) deve existir');

    await act(async () => {
      btnM22.props.onClick();
    });

    // Deve abrir o modal de bloqueio litúrgico de M22
    const modalTitle = root.find(node => node.props.className === 'modal-title');
    assert.ok(modalTitle, 'Modal de Bloqueio Litúrgico (M22) deve ser aberto');
    const modalJson = JSON.stringify(renderer.toJSON());
    assert.match(modalJson, /Bloqueio de Conflito de Escala \(PRD 5\.2\)/);

    // A alocação cumulativa foi terminantemente bloqueada (Beatriz não foi adicionada como Canto)
    const evt = appCtx.events.find(e => e.id === 'evt-m22');
    const targetAct = evt.activities.find(a => a.id === 'act-louvor-m22');
    assert.equal(targetAct.roster.length, 1);
    assert.equal(targetAct.roster[0].role, 'Dança');
  });

  test('Simulação de alocação com apoio paralelo (CA03) emite sinal sem bloquear a alocação', async () => {
    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    let renderer = null;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AppProvider,
          null,
          React.createElement(
            React.Fragment,
            null,
            React.createElement(Consumer),
            React.createElement(PlanningView)
          )
        )
      );
    });

    await act(async () => {
      appCtx.setMembers([
        { id: 'lucas', name: 'Lucas Silva', active: true, roles: ['membro'], skills: ['Sonoplastia', 'Canto'] },
      ]);
      appCtx.setEvents([{
        id: 'evt-ca03',
        church_id: CHURCH_ID,
        title: 'Culto CA03',
        status: 'scheduled',
        plannedStartAt: '2026-10-25T19:00:00-03:00',
        plannedEndAt: '2026-10-25T21:00:00-03:00',
        activitiesKnownInSession: true,
        parallelServices: [
          {
            id: 'serv-som-ca03',
            teamId: 'som',
            name: 'Sonoplastia',
            prepRequiredMinutes: 30,
            volunteers: ['lucas'],
          }
        ],
        activities: [
          {
            id: 'act-2',
            title: 'Louvor',
            category: 'Louvor',
            plannedDurationMinutes: 20,
            roster: [],
          }
        ],
      }]);
      appCtx.setCurrentEventId('evt-ca03');
    });

    const root = renderer.root;

    // Clica no botão Testar Conflito (CA03)
    const btnCA03 = root.find(node => node.props.id === 'btn-test-prep-conflict-som');
    assert.ok(btnCA03, 'Botão Testar Conflito (CA03) deve existir');

    await act(async () => {
      btnCA03.props.onClick();
    });

    // Conflito de apoio é SINAL: NÃO bloqueia a alocação! Lucas entra no roster
    const evt = appCtx.events.find(e => e.id === 'evt-ca03');
    const targetAct2 = evt.activities.find(a => a.id === 'act-2');
    assert.equal(targetAct2.roster.length, 1, 'Lucas deve ser inserido no roster pois conflito de apoio é SINAL e não bloqueia');
    assert.equal(targetAct2.roster[0].memberId, 'lucas');

    // E o painel de sinal de conflito na tela deve ser ativado
    const panel = root.find(node => node.props.id === 'panel-edition-scale-conflicts');
    assert.ok(panel, 'Painel de sinais de conflito deve estar visível');
  });

  test('Alocações remotas (list_event_assignments) são lidas pelo serviço de cliente e geram sinal de conflito', async () => {
    let capturedParams = null;
    const mockSupabase = {
      rpc: async (fn, params) => {
        if (fn === 'list_event_assignments') {
          capturedParams = params;
          return {
            data: {
              assignments: [
                {
                  id: 'asg-remota-1',
                  member_id: 'vol-remoto-01',
                  member_name: 'Mateus Santos',
                  item_id: 'act-palavra-01',
                  item_title: 'Ministração da Palavra',
                  role_name: 'Preletor',
                }
              ]
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }
    };

    // Chama o serviço de cliente getEventAssignmentsRemote
    const assignments = await getEventAssignmentsRemote(mockSupabase, CHURCH_ID, EVENT_ID);
    assert.deepEqual(capturedParams, { p_church_id: CHURCH_ID, p_event_id: EVENT_ID });
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].member_name, 'Mateus Santos');

    // Conflito derivado com preparação antecedente
    const event = {
      plannedStartAt: '2026-10-25T19:00:00-03:00',
      plannedEndAt: '2026-10-25T21:00:00-03:00',
      parallelServices: [
        {
          id: 'serv-portaria',
          name: 'Portaria e Recepção',
          prepRequiredMinutes: 45, // 18:15 às 21:00
          volunteers: ['vol-remoto-01'],
        }
      ],
      activities: [
        {
          id: 'act-palavra-01',
          title: 'Ministração da Palavra',
          plannedDurationMinutes: 45, // 19:00 às 19:45
        }
      ]
    };

    const conflictsOutcome = calculateEditionScaleConflicts(event, assignments, [{ id: 'vol-remoto-01', name: 'Mateus Santos' }]);
    assert.equal(conflictsOutcome.calculable, true);
    assert.equal(conflictsOutcome.conflicts.length, 1);
    assert.equal(conflictsOutcome.conflicts[0].memberName, 'Mateus Santos');
    assert.equal(conflictsOutcome.conflicts[0].serviceName, 'Portaria e Recepção');
    assert.equal(conflictsOutcome.conflicts[0].prepRequiredMinutes, 45);
  });

  describe('Ajustes CA03/CA04 — Janela de Ocupação no Cartão e Conflitos do Líder', () => {
    test('(a) Janela exibida no cartão com preparação antecedente (ex: 18:30–21:00)', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let renderer = null;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            AppProvider,
            null,
            React.createElement(
              React.Fragment,
              null,
              React.createElement(Consumer),
              React.createElement(PlanningView)
            )
          )
        );
      });

      await act(async () => {
        appCtx.setEvents([{
          id: 'evt-card-prep',
          church_id: CHURCH_ID,
          title: 'Culto Noturno',
          status: 'scheduled',
          timezone: 'America/Sao_Paulo',
          plannedStartAt: '2026-10-25T19:00:00-03:00',
          plannedEndAt: '2026-10-25T21:00:00-03:00',
          activitiesKnownInSession: true,
          parallelServices: [
            {
              id: 'serv-transmissao-prep',
              name: 'Transmissão',
              prepRequiredMinutes: 30, // 18:30 às 21:00
              volunteers: [],
            }
          ],
          activities: [],
          assignments: [],
        }]);
        appCtx.setCurrentEventId('evt-card-prep');
      });

      const root = renderer.root;
      const windowNode = root.find(node => node.props.className === 'parallel-service-occupancy-window');
      assert.ok(windowNode, 'Deve renderizar a janela de ocupação');
      const text = getNodeText(windowNode);
      assert.match(text, /18:30\s*[–-]\s*21:00/);
      assert.match(text, /inclui 30 min de preparação antes do culto/i);
    });

    test('(b) Janela exibida no cartão sem preparação (prepRequiredMinutes = 0)', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let renderer = null;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            AppProvider,
            null,
            React.createElement(
              React.Fragment,
              null,
              React.createElement(Consumer),
              React.createElement(PlanningView)
            )
          )
        );
      });

      await act(async () => {
        appCtx.setEvents([{
          id: 'evt-card-no-prep',
          church_id: CHURCH_ID,
          title: 'Culto Noturno Sem Prep',
          status: 'scheduled',
          timezone: 'America/Sao_Paulo',
          plannedStartAt: '2026-10-25T19:00:00-03:00',
          plannedEndAt: '2026-10-25T21:00:00-03:00',
          activitiesKnownInSession: true,
          parallelServices: [
            {
              id: 'serv-portaria-no-prep',
              name: 'Portaria',
              prepRequiredMinutes: 0,
              volunteers: [],
            }
          ],
          activities: [],
          assignments: [],
        }]);
        appCtx.setCurrentEventId('evt-card-no-prep');
      });

      const root = renderer.root;
      const windowNode = root.find(node => node.props.className === 'parallel-service-occupancy-window');
      assert.ok(windowNode, 'Deve renderizar a janela de ocupação');
      const text = getNodeText(windowNode);
      assert.match(text, /19:00\s*[–-]\s*21:00/);
      assert.doesNotMatch(text, /preparação antes do culto/i);
    });

    test('(c) Janela não calculável sem horário final previsto (sem inventar horário e sem fallback 21:00)', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let renderer = null;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            AppProvider,
            null,
            React.createElement(
              React.Fragment,
              null,
              React.createElement(Consumer),
              React.createElement(PlanningView)
            )
          )
        );
      });

      await act(async () => {
        appCtx.setEvents([{
          id: 'evt-card-no-end',
          church_id: CHURCH_ID,
          title: 'Culto Sem Fim',
          status: 'scheduled',
          plannedStartAt: '2026-10-25T19:00:00-03:00',
          plannedEndAt: null, // Sem término previsto
          activitiesKnownInSession: true,
          parallelServices: [
            {
              id: 'serv-som-no-end',
              name: 'Sonoplastia',
              prepRequiredMinutes: 30,
              volunteers: [],
            }
          ],
          activities: [],
          assignments: [],
        }]);
        appCtx.setCurrentEventId('evt-card-no-end');
      });

      const root = renderer.root;
      const windowNode = root.find(node => node.props.className === 'parallel-service-occupancy-window');
      assert.ok(windowNode, 'Deve renderizar o aviso na classe parallel-service-occupancy-window');
      const text = getNodeText(windowNode);
      assert.match(text, /não calculável por falta de horário previsto/i);
      assert.doesNotMatch(text, /21:00/);
    });

    test('(d) Conflito do líder de apoio aparece no cartão do serviço (casamento por sourceId)', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let renderer = null;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            AppProvider,
            null,
            React.createElement(
              React.Fragment,
              null,
              React.createElement(Consumer),
              React.createElement(PlanningView)
            )
          )
        );
      });

      await act(async () => {
        appCtx.setMembers([
          { id: 'vol-lider-som', name: 'Rodrigo Líder', active: true, roles: ['membro'], skills: ['Sonoplastia', 'Vocal'] }
        ]);
        appCtx.setEvents([{
          id: 'evt-leader-conflict',
          church_id: CHURCH_ID,
          title: 'Culto com Conflito do Líder',
          status: 'scheduled',
          plannedStartAt: '2026-10-25T19:00:00-03:00',
          plannedEndAt: '2026-10-25T21:00:00-03:00',
          activitiesKnownInSession: true,
          parallelServices: [
            {
              id: 'serv-som-leader-id',
              name: 'Sonoplastia',
              prepRequiredMinutes: 20,
              leaderId: 'vol-lider-som', // Líder do apoio
              volunteers: [],
            }
          ],
          activities: [
            {
              id: 'act-louvor-lead',
              title: 'Louvor com Líder',
              category: 'Louvor',
              plannedDurationMinutes: 30,
              roster: [
                { memberId: 'vol-lider-som', role: 'Vocal' }
              ],
            }
          ],
          assignments: [],
        }]);
        appCtx.setCurrentEventId('evt-leader-conflict');
      });

      const root = renderer.root;

      // 1. Painel geral deve exibir o conflito do líder
      const panel = root.find(node => node.props.id === 'panel-edition-scale-conflicts');
      assert.ok(panel, 'Painel geral de conflitos deve estar presente');
      const panelJson = JSON.stringify(renderer.toJSON());
      assert.match(panelJson, /Rodrigo Líder/);
      assert.match(panelJson, /Sonoplastia \(Líder\)/);

      // 2. Cartão do apoio Sonoplastia DEVE exibir o alerta de conflito do líder
      const cardWarning = root.find(node => node.props.className === 'service-conflict-warning');
      assert.ok(cardWarning, 'Cartão do apoio deve exibir aviso de conflito');
      const cardText = getNodeText(cardWarning);
      assert.match(cardText, /Rodrigo Líder/);
    });

    test('(e) Dois apoios com o mesmo líder e janelas sobrepostas: cartão do Apoio B cita Apoio A (e não Apoio B) e cartão do Apoio A cita Apoio B', async () => {
      let appCtx = null;
      function Consumer() {
        appCtx = useApp();
        return null;
      }

      let renderer = null;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(
            AppProvider,
            null,
            React.createElement(
              React.Fragment,
              null,
              React.createElement(Consumer),
              React.createElement(PlanningView)
            )
          )
        );
      });

      await act(async () => {
        appCtx.setMembers([
          { id: 'vol-lider-duplo', name: 'Lucas Supervisor', active: true, roles: ['membro'], skills: ['Apoio A', 'Apoio B'] }
        ]);
        appCtx.setEvents([{
          id: 'evt-two-services-leader',
          church_id: CHURCH_ID,
          title: 'Culto Dois Apoios',
          status: 'scheduled',
          plannedStartAt: '2026-10-25T19:00:00-03:00',
          plannedEndAt: '2026-10-25T21:00:00-03:00',
          activitiesKnownInSession: true,
          parallelServices: [
            {
              id: 'serv-apoio-a',
              name: 'Apoio A',
              prepRequiredMinutes: 15,
              leaderId: 'vol-lider-duplo',
              volunteers: [],
            },
            {
              id: 'serv-apoio-b',
              name: 'Apoio B',
              prepRequiredMinutes: 30,
              leaderId: 'vol-lider-duplo',
              volunteers: [],
            }
          ],
          activities: [],
          assignments: [],
        }]);
        appCtx.setCurrentEventId('evt-two-services-leader');
      });

      const root = renderer.root;

      // Localizar os títulos dos serviços nos cartões
      const h3A = root.find(n => n.type === 'h3' && getNodeText(n) === 'Apoio A');
      const h3B = root.find(n => n.type === 'h3' && getNodeText(n) === 'Apoio B');
      assert.ok(h3A && h3B, 'Deve encontrar os títulos dos serviços Apoio A e Apoio B');

      // Obter o cartão correspondente a cada serviço (avô do h3)
      const cardA = h3A.parent.parent;
      const cardB = h3B.parent.parent;

      const itemA = cardA.find(n => n.props?.className === 'service-conflict-item');
      const itemB = cardB.find(n => n.props?.className === 'service-conflict-item');
      assert.ok(itemA, 'Cartão do Apoio A deve conter .service-conflict-item');
      assert.ok(itemB, 'Cartão do Apoio B deve conter .service-conflict-item');

      const textItemA = getNodeText(itemA);
      const textItemB = getNodeText(itemB);

      // O cartão do Apoio A deve citar o Apoio B
      assert.match(textItemA, /Apoio B/);

      // O cartão do Apoio B deve conter o nome do Apoio A e NÃO deve citar "Apoio B" dentro de .service-conflict-item
      assert.match(textItemB, /Apoio A/);
      assert.doesNotMatch(textItemB, /Apoio B/);
    });
  });
});
