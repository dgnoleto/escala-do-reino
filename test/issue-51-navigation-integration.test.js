import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'issue-51-navigation-integration.bundle.mjs');

await build({
  stdin: {
    contents: `
      export { default as ChurchHomePage } from './src/components/ChurchHomePage.jsx';
      export { default as AdminView } from './src/components/AdminView.jsx';
      export { default as PlanningView } from './src/components/PlanningView.jsx';
      export { AppProvider, useApp } from './src/context/AppContext.jsx';
      export { AuthContext } from './src/context/AuthContext.jsx';
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

const {
  ChurchHomePage,
  AdminView,
  PlanningView,
  AppProvider,
  useApp,
  AuthContext,
} = await import(pathToFileURL(bundlePath).href);

// Mock DOM
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

function createMockAuthContext({
  isAdmin = false,
  displayName = 'Membro Real Teste',
  churchName = 'Igreja Comunidade Real',
  churchId = 'real-church-uuid-123',
  memberId = 'real-member-uuid-456',
  timezone = 'America/Sao_Paulo',
} = {}) {
  return {
    authState: 'access_granted',
    session: { user: { id: 'auth-user-id-789', email: 'teste@exemplo.com' } },
    sessionId: 'session-token-abc',
    churchAccess: {
      church_id: churchId,
      church_name: churchName,
      display_name: displayName,
      member_id: memberId,
      is_admin: isAdmin,
      timezone,
      default_duration_policy: 'warn',
    },
    availableAccesses: [{ church_id: churchId, church_name: churchName, is_admin: isAdmin }],
    selectChurch: () => {},
    signOut: () => {},
    refreshAccess: () => {},
    recordCreationConfirmation: () => {},
    reloadChurchAccess: () => {},
  };
}

function findElementById(root, id) {
  try {
    return root.findByProps({ id });
  } catch {
    return null;
  }
}

function findAllElementsByType(root, type) {
  try {
    return root.findAllByType(type);
  } catch {
    return [];
  }
}

describe('Issue #51: Integração de Cadastros e Planejamento à Jornada Autenticada', () => {
  const CHURCH_ID = '01700000-0000-4000-8000-000000000001';

  test('CA01: Administrador localiza os cadastros pela navegação real da ChurchHomePage', async () => {
    const authVal = createMockAuthContext({
      isAdmin: true,
      displayName: 'Pastor Silva',
      churchName: 'Igreja Esperança Viva',
      churchId: CHURCH_ID,
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authVal },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: false },
            React.createElement(ChurchHomePage)
          )
        )
      );
    });

    // 1. Botão de acesso aos cadastros deve existir para Administrador
    const btnCadastros = findElementById(renderer.root, 'btn-goto-admin-cadastros');
    assert.ok(btnCadastros, 'Botão #btn-goto-admin-cadastros deve existir na ChurchHomePage do Administrador');

    // 2. Acionar navegação para Cadastros
    await act(async () => {
      btnCadastros.props.onClick();
    });

    // 3. AdminView deve estar montado com os cadastros litúrgicos
    const tabEventTypes = findElementById(renderer.root, 'tab-admin-event-types');
    assert.ok(tabEventTypes, 'Aba Tipos de Evento deve estar presente em AdminView');

    const tabActivities = findElementById(renderer.root, 'tab-admin-activities');
    assert.ok(tabActivities, 'Aba Atividades e Durações deve estar presente em AdminView');

    const tabTemplates = findElementById(renderer.root, 'tab-admin-templates');
    assert.ok(tabTemplates, 'Aba Modelos de Culto deve estar presente em AdminView');

    const tabLiturgy = findElementById(renderer.root, 'tab-admin-liturgy');
    assert.ok(tabLiturgy, 'Aba Designação da Liturgia deve estar presente em AdminView');
  });

  test('CA02: Usuário sem permissão não visualiza atalhos administrativos e encontra bloqueio seguro sem vazamento', async () => {
    const authValMember = createMockAuthContext({
      isAdmin: false,
      displayName: 'Mariana Costa (Membro)',
      churchName: 'Igreja Esperança Viva',
      churchId: CHURCH_ID,
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authValMember },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: false },
            React.createElement(ChurchHomePage)
          )
        )
      );
    });

    // 1. Membro comum NÃO vê botão de cadastros administrativos
    const btnCadastros = findElementById(renderer.root, 'btn-goto-admin-cadastros');
    assert.equal(btnCadastros, null, 'Membro básico NÃO deve ter acesso ao botão #btn-goto-admin-cadastros');

    // 2. Montar AdminView diretamente com perfil de membro
    let adminRenderer;
    await act(async () => {
      adminRenderer = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authValMember },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: false },
            React.createElement(AdminView, { onBack: () => {} })
          )
        )
      );
    });

    const renderedJson = JSON.stringify(adminRenderer.toJSON());
    assert.match(renderedJson, /Acesso Administrativo Restrito/);
    assert.doesNotMatch(renderedJson, /Pastor Marcos Ribeiro/);
    assert.doesNotMatch(renderedJson, /mude seu perfil/);

    const btnBack = findElementById(adminRenderer.root, 'btn-back-to-home');
    assert.ok(btnBack, 'Botão #btn-back-to-home deve estar presente na tela de restrição');
  });

  test('CA03: Eventos podem ser criados por administradores e consultados por membros na navegação real', async () => {
    // 1. Membro comum acessa planejamento na ChurchHomePage
    const authMember = createMockAuthContext({ isAdmin: false, displayName: 'Lucas Membro' });
    let rendererMember;
    await act(async () => {
      rendererMember = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authMember },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: false },
            React.createElement(ChurchHomePage)
          )
        )
      );
    });

    const btnPlanning = findElementById(rendererMember.root, 'btn-goto-planning');
    assert.ok(btnPlanning, 'Membro deve ter acesso ao botão #btn-goto-planning');

    await act(async () => {
      btnPlanning.props.onClick();
    });

    // Em PlanningView sem eventos, botão de criar evento está desabilitado para membro comum
    const btnCreateEventMember = findElementById(rendererMember.root, 'btn-open-create-event-modal');
    assert.equal(btnCreateEventMember, null, 'Membro comum sem liderança da liturgia não pode criar edições de culto');

    // 2. Administrador acessa planejamento e pode acionar criação
    const authAdmin = createMockAuthContext({ isAdmin: true, displayName: 'Pastor Administrador' });
    let rendererAdmin;
    await act(async () => {
      rendererAdmin = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authAdmin },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: false },
            React.createElement(PlanningView, { onBack: () => {} })
          )
        )
      );
    });

    const btnCreateEventAdmin = findElementById(rendererAdmin.root, 'btn-open-create-event-modal');
    assert.ok(btnCreateEventAdmin, 'Administrador deve ter botão #btn-open-create-event-modal habilitado');
  });

  test('CA04: Planejamento exibe a edição e fuso horário corretos da igreja', async () => {
    let renderer;
    const testEvent = {
      id: 'event-culto-domingo',
      title: 'Culto de Celebração Real',
      date: '2026-10-25',
      scheduledStartTime: '19:00',
      plannedDurationMinutes: 105,
      timezone: 'America/Manaus',
      programStatus: 'draft',
      programVersion: 1,
      activities: [],
      parallelServices: [],
    };

    const mockClient = {
      rpc: async (fn) => {
        if (fn === 'list_cancellation_reasons') return { data: [], error: null };
        if (fn === 'list_event_types') return { data: [], error: null };
        if (fn === 'list_standard_activities') return { data: [], error: null };
        if (fn === 'list_service_templates') return { data: [], error: null };
        return { data: [], error: null };
      },
    };

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AppProvider,
          {
            initialUserId: 'admin-1',
            churchId: CHURCH_ID,
            supabaseClient: mockClient,
          },
          React.createElement(PlanningView, { onBack: () => {} })
        )
      );
    });

    const selectorBar = findElementById(renderer.root, 'planning-event-selector-bar');
    assert.ok(selectorBar, 'Barra de seleção de evento #planning-event-selector-bar deve estar presente');

    const tzBadge = findElementById(renderer.root, 'badge-event-timezone');
    assert.ok(tzBadge, 'Badge de fuso horário deve ser exibido no cabeçalho');
  });

  test('CA05: Supabase indisponível (migrações 020-023 não aplicadas) exibe banner informativo amigável sem falso sucesso', async () => {
    // Simula cliente Supabase retornando PGRST202 (funções 020 a 023 inexistentes no banco piloto)
    const pgrst202Client = {
      rpc: async () => ({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' },
      }),
    };

    const authVal = createMockAuthContext({
      isAdmin: true,
      displayName: 'Pastor Ricardo',
      churchName: 'Igreja Nova Vida',
      churchId: CHURCH_ID,
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authVal },
          React.createElement(
            AppProvider,
            {
              churchId: CHURCH_ID,
              supabaseClient: pgrst202Client,
              allowMemoryFallback: false,
            },
            React.createElement(AdminView, { onBack: () => {} })
          )
        )
      );
    });

    // Aguarda resolução das promessas de sincronização remota
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const banner = findElementById(renderer.root, 'banner-backend-unavailability');
    assert.ok(banner, 'Banner #banner-backend-unavailability deve estar visível');

    const json = JSON.stringify(renderer.toJSON());
    assert.match(json, /Indisponibilidade de Serviços de Cadastros no Supabase/);
    assert.match(json, /migrações 020 a 023/);
  });

  test('CA06: Ausência total de dados e personas fictícias na sessão real', async () => {
    const authVal = createMockAuthContext({
      isAdmin: true,
      displayName: 'Presbítero Daniel',
      churchName: 'Comunidade da Fé',
      churchId: CHURCH_ID,
      memberId: 'dan-uuid-001',
    });

    let consumedApp = null;
    function Consumer() {
      consumedApp = useApp();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authVal },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: false },
            React.createElement(Consumer)
          )
        )
      );
    });

    // 1. Identidade e perfil extraídos da sessão real
    assert.equal(consumedApp.currentUser.name, 'Presbítero Daniel');
    assert.equal(consumedApp.currentUser.id, 'dan-uuid-001');
    assert.equal(consumedApp.isAdmin, true);
    assert.equal(consumedApp.church.name, 'Comunidade da Fé');

    // 2. Não possui dados mockados do protótipo
    assert.notEqual(consumedApp.currentUser.name, 'Carlos Oliveira');
    assert.notEqual(consumedApp.currentUser.name, 'Pastor Marcos Ribeiro');
    assert.notEqual(consumedApp.church.name, 'Igreja Batista Central de Goiânia');
  });

  test('CA07: Navegação de retorno intuitiva com botão voltar ao início em todas as subtelas', async () => {
    let returnedHome = false;
    const authVal = createMockAuthContext({ isAdmin: true });

    // Teste no AdminView
    let adminRenderer;
    await act(async () => {
      adminRenderer = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authVal },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: false },
            React.createElement(AdminView, { onBack: () => { returnedHome = true; } })
          )
        )
      );
    });

    const btnBackAdmin = findElementById(adminRenderer.root, 'btn-back-to-home');
    assert.ok(btnBackAdmin, 'AdminView deve possuir botão #btn-back-to-home');
    btnBackAdmin.props.onClick();
    assert.equal(returnedHome, true, 'Clicar em #btn-back-to-home deve disparar callback onBack');

    // Teste no PlanningView
    returnedHome = false;
    let planningRenderer;
    await act(async () => {
      planningRenderer = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authVal },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: false },
            React.createElement(PlanningView, { onBack: () => { returnedHome = true; } })
          )
        )
      );
    });

    const btnBackPlanning = findElementById(planningRenderer.root, 'btn-back-to-home');
    assert.ok(btnBackPlanning, 'PlanningView deve possuir botão #btn-back-to-home');
    btnBackPlanning.props.onClick();
    assert.equal(returnedHome, true, 'Clicar em #btn-back-to-home no PlanningView deve disparar callback onBack');
  });

  test('CA08: Isolamento multi-tenant: alteração de igreja limpa dados em memória', async () => {
    const CHURCH_A = 'church-aaa-111';
    const CHURCH_B = 'church-bbb-222';

    let capturedApp = null;
    function Consumer() {
      capturedApp = useApp();
      return null;
    }

    const mockRpcClient = {
      rpc: async (fn, params) => {
        if (fn === 'list_cancellation_reasons') {
          if (params?.p_church_id === CHURCH_A) {
            return { data: [{ id: 'cr-1', name: 'Motivo Igreja A', active: true }], error: null };
          }
          if (params?.p_church_id === CHURCH_B) {
            return { data: [{ id: 'cr-2', name: 'Motivo Igreja B', active: true }], error: null };
          }
        }
        return { data: [], error: null };
      },
    };

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AppProvider,
          {
            churchId: CHURCH_A,
            supabaseClient: mockRpcClient,
          },
          React.createElement(Consumer)
        )
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    assert.equal(capturedApp.cancelReasons.length, 1);
    assert.equal(capturedApp.cancelReasons[0].name, 'Motivo Igreja A');

    // Altera para a Igreja B
    await act(async () => {
      renderer.update(
        React.createElement(
          AppProvider,
          {
            churchId: CHURCH_B,
            supabaseClient: mockRpcClient,
          },
          React.createElement(Consumer)
        )
      );
    });

    // O estado da Igreja A não vaza para a Igreja B e é substituído pelo da Igreja B
    assert.equal(capturedApp.cancelReasons.length, 1);
    assert.equal(capturedApp.cancelReasons[0].name, 'Motivo Igreja B');
  });
});
