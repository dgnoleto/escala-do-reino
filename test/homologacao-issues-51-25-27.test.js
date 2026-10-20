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
const bundlePath = path.join(cacheDir, 'homologacao-issues-51-25-27.bundle.mjs');

await build({
  stdin: {
    contents: `
      export { default as ChurchHomePage } from './src/components/ChurchHomePage.jsx';
      export { default as AdminView } from './src/components/AdminView.jsx';
      export { AppProvider, useApp } from './src/context/AppContext.jsx';
      export { AuthContext } from './src/context/AuthContext.jsx';
      export * from './src/utils/eventTypeActivityService.js';
      export * from './src/utils/serviceTemplateService.js';
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
  AppProvider,
  useApp,
  AuthContext,
  toStandardActivityObject,
  createStandardActivityRemote,
  updateStandardActivityRemote,
  eventTypeActivityErrorMessage,
  toServiceTemplateObject,
  createServiceTemplateRemote,
  serviceTemplateErrorMessage,
} = await import(pathToFileURL(bundlePath).href);

// Mock DOM ambiental
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
  isAdmin = true,
  displayName = 'Pastor Administrador',
  churchName = 'Igreja Presbiteriana Central',
  churchId = '01700000-0000-4000-8000-000000000001',
  memberId = '01700000-0000-4000-8000-000000000002',
} = {}) {
  return {
    authState: 'access_granted',
    session: { user: { id: 'auth-user-id-1', email: 'admin@igreja.org' } },
    sessionId: 'session-token-test',
    churchAccess: {
      church_id: churchId,
      church_name: churchName,
      display_name: displayName,
      member_id: memberId,
      is_admin: isAdmin,
      timezone: 'America/Sao_Paulo',
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

function getNodeText(node) {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join(' ');
  if (node.children) return getNodeText(node.children);
  return '';
}

describe('Homologação Funcional — Issue #51 (Responsividade e Navegação Administrativa)', () => {
  test('51.1: ChurchHomePage renderiza layout fluido adaptativo e padroniza nomenclatura "Administração da Igreja"', async () => {
    const authVal = createMockAuthContext({ isAdmin: true });
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

    const renderedString = JSON.stringify(renderer.toJSON());

    // 1. Presença do card padronizado "Administração da Igreja"
    assert.match(renderedString, /Administração da Igreja/, 'O card principal deve exibir "Administração da Igreja"');

    // 2. Presença do botão de acesso à administração preservando compatibilidade
    const btnAdmin = findElementById(renderer.root, 'btn-goto-admin-cadastros');
    assert.ok(btnAdmin, 'Botão #btn-goto-admin-cadastros deve existir');
    assert.match(JSON.stringify(btnAdmin.children), /Acessar Administração/);

    // 3. Estrutura de grid adaptativo para desktop/tablet/mobile
    assert.match(renderedString, /church-home-grid/, 'Deve conter a classe church-home-grid');
    assert.match(renderedString, /max-width:\s*1040px/, 'O container deve suportar até 1040px em telas amplas');
    assert.doesNotMatch(renderedString, /max-width:\s*440px/, 'Não deve manter o limite móvel estreito de 440px no card');
  });

  test('51.2: AdminView apresenta cabeçalho "Administração da Igreja" e abas na ordem prioritária acordada', async () => {
    const authVal = createMockAuthContext({ isAdmin: true });
    let renderer;

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authVal },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: true },
            React.createElement(AdminView, { onBack: () => {} })
          )
        )
      );
    });

    const renderedString = JSON.stringify(renderer.toJSON());

    // 1. Título do cabeçalho
    assert.match(renderedString, /Administração da Igreja/, 'Título de cabeçalho em AdminView deve ser "Administração da Igreja"');

    // 2. Abas presentes com seus IDs
    const tabEventTypes = findElementById(renderer.root, 'tab-admin-event-types');
    const tabTemplates = findElementById(renderer.root, 'tab-admin-templates');
    const tabActivities = findElementById(renderer.root, 'tab-admin-activities');
    const tabReasons = findElementById(renderer.root, 'tab-admin-reasons');
    const tabInvites = findElementById(renderer.root, 'tab-admin-invites');
    const tabLiturgy = findElementById(renderer.root, 'tab-admin-liturgy');
    const tabMembers = findElementById(renderer.root, 'tab-admin-members');

    assert.ok(tabEventTypes, 'Aba Tipos de Evento deve estar presente');
    assert.ok(tabTemplates, 'Aba Modelos de Culto deve estar presente');
    assert.ok(tabActivities, 'Aba Atividades e Durações deve estar presente');
    assert.ok(tabReasons, 'Aba Motivos de Cancelamento deve estar presente');
    assert.ok(tabInvites, 'Aba Convites de Acesso deve estar presente');
    assert.ok(tabLiturgy, 'Aba Designação da Liturgia deve estar presente');
    assert.ok(tabMembers, 'Aba Membros e Aptidões deve estar presente');

    // 3. Ordem das abas na árvore de renderização
    const tabsContainer = renderer.root.findByProps({ className: 'admin-nav-tabs' });
    const tabChildrenIds = tabsContainer.children
      .filter(c => typeof c === 'object' && c.props && c.props.id)
      .map(c => c.props.id);

    assert.deepEqual(tabChildrenIds, [
      'tab-admin-event-types',
      'tab-admin-templates',
      'tab-admin-activities',
      'tab-admin-reasons',
      'tab-admin-invites',
      'tab-admin-liturgy',
      'tab-admin-members'
    ], 'As abas devem seguir a ordem de prioridade acordada');

    // 4. Seleção padrão na primeira opção (event_types)
    assert.equal(tabEventTypes.props['aria-selected'], true, 'Tipos de Evento deve ser a aba ativa por padrão');
    assert.match(tabEventTypes.props.className, /active/);

    // 5. CSS com flex-wrap: wrap para evitar quebras responsivas
    assert.match(renderedString, /flex-wrap:\s*wrap/, 'As abas administrativas devem quebrar linha responsivamente');
  });

  test('51.3: Navegação com destino específico respeita a rota e sincroniza aba com conteúdo', async () => {
    const authVal = createMockAuthContext({ isAdmin: true });
    let renderer;

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authVal },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: true },
            React.createElement(AdminView, { onBack: () => {}, initialTab: 'templates' })
          )
        )
      );
    });

    const tabTemplates = findElementById(renderer.root, 'tab-admin-templates');
    assert.ok(tabTemplates, 'Aba Modelos de Culto deve existir');
    assert.equal(tabTemplates.props['aria-selected'], true, 'Aba Modelos de Culto deve estar ativa');

    const json = JSON.stringify(renderer.toJSON());
    assert.match(json, /Modelos de Culto Cadastrados/, 'Conteúdo de modelos de culto deve estar renderizado');
  });
});

describe('Homologação Funcional — Issue #25 (Correção da Edição de Atividades Padrão com UUID)', () => {
  test('25.1: createStandardActivityRemote extrai o UUID persistido retornado pela RPC do Postgres', async () => {
    const realDbUuid = 'a0000000-0000-4000-8000-000000000001';
    const mockClient = {
      rpc: async (fn, params) => {
        if (fn === 'create_standard_activity') {
          return {
            data: { status: 'ok', id: realDbUuid, church_id: params.p_church_id },
            error: null
          };
        }
        return { data: null, error: null };
      }
    };

    const res = await createStandardActivityRemote(
      mockClient,
      '01700000-0000-4000-8000-000000000001',
      'Oração e Intercessão',
      12,
      'Liturgia',
      'Momento congregacional'
    );

    assert.equal(res.success, true);
    assert.equal(res.data.id, realDbUuid, 'O ID extraído DEVE ser o UUID retornado pelo banco, e NÃO sa-*');
    assert.doesNotMatch(res.data.id, /^sa-/, 'Nenhum identificador sintético sa- deve ser gerado');
  });

  test('25.2: toStandardActivityObject mapeia colunas snake_case do banco de dados', () => {
    const dbRow = {
      id: 'a0000000-0000-4000-8000-000000000099',
      name: 'Leitura Bíblica',
      default_duration_minutes: 8,
      category: 'Palavra',
      description: 'Texto do dia',
      is_active: true,
      created_at: '2026-10-19T10:00:00Z',
      updated_at: '2026-10-19T10:05:00Z',
    };

    const obj = toStandardActivityObject(dbRow);

    assert.equal(obj.id, 'a0000000-0000-4000-8000-000000000099');
    assert.equal(obj.defaultDurationMinutes, 8, 'default_duration_minutes deve ser mapeado para defaultDurationMinutes');
    assert.equal(obj.createdAt, '2026-10-19T10:00:00Z');
    assert.equal(obj.updatedAt, '2026-10-19T10:05:00Z');
  });

  test('25.3: Tratamento de erro PostgreSQL 22P02 (invalid input syntax for type uuid) gera mensagem clara', () => {
    const pgError = {
      code: '22P02',
      message: 'invalid input syntax for type uuid: "sa-1771505367389"',
    };

    const msg = eventTypeActivityErrorMessage(pgError, 'atualizar atividade padrão');

    assert.match(msg, /Identificador inválido/);
    assert.match(msg, /Atualize a página/);
    assert.doesNotMatch(msg, /undefined/);
  });

  test('25.4: AppContext bloqueia envio de IDs sintéticos sa- em modo remoto e preserva integridade', async () => {
    let capturedContext;
    function Consumer() {
      capturedContext = useApp();
      return null;
    }

    const authVal = createMockAuthContext({ isAdmin: true });
    const mockClient = {
      rpc: async (fn, params) => {
        return { data: [], error: null };
      }
    };

    await act(async () => {
      TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authVal },
          React.createElement(
            AppProvider,
            {
              churchId: '01700000-0000-4000-8000-000000000001',
              supabaseClient: mockClient,
              allowMemoryFallback: false
            },
            React.createElement(Consumer)
          )
        )
      );
    });

    // Tentar atualizar uma atividade com ID sintético sa-...
    const res = await capturedContext.updateStandardActivity('sa-1771505367389', 'Tentativa Inválida', 15);

    assert.equal(res.success, false);
    assert.match(res.error, /Identificador de atividade padrão inválido ou não sincronizado/);
  });
});

describe('Homologação Funcional — Issue #27 (Reordenação de Atividades e Construtor de Serviços Paralelos)', () => {
  test('27.1: Reordenação de atividades do modelo suporta controles de subir/descer e Drag & Drop com renumeração', async () => {
    const authVal = createMockAuthContext({ isAdmin: true });
    let renderer;

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authVal },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: true },
            React.createElement(AdminView, { onBack: () => {}, initialTab: 'templates' })
          )
        )
      );
    });

    // 1. Verificar botões de subir e descer nas etapas litúrgicas
    const btnMoveUp0 = findElementById(renderer.root, 'btn-move-up-template-activity-0');
    const btnMoveDown0 = findElementById(renderer.root, 'btn-move-down-template-activity-0');

    assert.ok(btnMoveUp0, 'Botão subir atividade 0 deve existir');
    assert.ok(btnMoveDown0, 'Botão descer atividade 0 deve existir');
    assert.equal(btnMoveUp0.props.disabled, true, 'Primeira atividade não pode subir mais');
    assert.equal(btnMoveDown0.props.disabled, false, 'Primeira atividade pode descer');

    // 2. Acionar descida da primeira atividade
    await act(async () => {
      btnMoveDown0.props.onClick();
    });

    // A segunda etapa anterior agora é a primeira
    const row0 = findElementById(renderer.root, 'template-activity-row-0');
    assert.match(getNodeText(row0), /Louvor e Adoração Congregacional/);

    const row1 = findElementById(renderer.root, 'template-activity-row-1');
    assert.match(getNodeText(row1), /Boas-Vindas e Oração Inicial/);
  });

  test('27.2: Construtor de serviços paralelos oferece presets recomendados e adição personalizada', async () => {
    const authVal = createMockAuthContext({ isAdmin: true });
    let renderer;

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authVal },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: true },
            React.createElement(AdminView, { onBack: () => {}, initialTab: 'templates' })
          )
        )
      );
    });

    // 1. Presets de Limpeza, Som, Portaria, Transmissão presentes
    const btnPresetLimpeza = findElementById(renderer.root, 'btn-preset-service-limpeza');
    const btnPresetSom = findElementById(renderer.root, 'btn-preset-service-som');
    const btnPresetPortaria = findElementById(renderer.root, 'btn-preset-service-portaria');
    const btnPresetMidia = findElementById(renderer.root, 'btn-preset-service-midia');

    assert.ok(btnPresetLimpeza, 'Preset Limpeza deve estar disponível');
    assert.ok(btnPresetSom, 'Preset Sonoplastia deve estar disponível');
    assert.ok(btnPresetPortaria, 'Preset Portaria deve estar disponível');
    assert.ok(btnPresetMidia, 'Preset Transmissão deve estar disponível');

    // 2. Input de antecedência de preparação
    const prepInput0 = findElementById(renderer.root, 'parallel-service-prep-0');
    assert.ok(prepInput0, 'Input de minutos de preparação deve existir');

    // 3. Indicador de início prévio de preparação ao culto
    const rowParallel0 = findElementById(renderer.root, 'template-parallel-service-row-0');
    assert.match(getNodeText(rowParallel0), /Inicia.*min antes/);

    // 4. Botão para adicionar serviço customizado
    const btnAddCustom = findElementById(renderer.root, 'btn-add-custom-parallel-service');
    assert.ok(btnAddCustom, 'Botão para adicionar serviço paralelo customizado deve existir');
  });

  test('27.3: Duração litúrgica não soma serviços paralelos e não escala pessoas automaticamente', async () => {
    const authVal = createMockAuthContext({ isAdmin: true });
    let renderer;

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthContext.Provider,
          { value: authVal },
          React.createElement(
            AppProvider,
            { allowMemoryFallback: true },
            React.createElement(AdminView, { onBack: () => {}, initialTab: 'templates' })
          )
        )
      );
    });

    const rendered = JSON.stringify(renderer.toJSON());

    // 1. A duração litúrgica é a soma estrita das atividades litúrgicas (5 + 25 + 45 + 5 = 80 min)
    assert.match(rendered, /Dura.*o Lit.*rgica Total/);
    assert.match(rendered, /80.*min/);

    // 2. Nota normativa de que o modelo não escala pessoas e não soma tempo
    assert.match(rendered, /não escala nem confirma pessoas automaticamente/);
    assert.match(rendered, /não somam sua duração ao tempo litúrgico/);
  });
});
