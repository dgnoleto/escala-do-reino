import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  formatTeamsListErrorMessage,
} from '../src/utils/liturgicalCommandService.js';

// Prepara diretório de cache em node_modules para compilação do componente TeamsPage
const cacheDir = path.resolve(process.cwd(), 'node_modules', '.cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}
const bundlePath = path.join(cacheDir, 'teams-components-test-bundle.mjs');

await build({
  stdin: {
    contents: `
      export { default as TeamsPage } from './src/components/TeamsPage.jsx';
      export { AuthProvider, useAuth } from './src/context/AuthContext.jsx';
    `,
    resolveDir: process.cwd(),
    loader: 'jsx',
  },
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['react', 'react-dom', 'lucide-react'],
  plugins: [{
    name: 'review-transport-teams',
    setup(builder) {
      builder.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'transport', namespace: 'review' }));
      builder.onLoad({ filter: /.*/, namespace: 'review' }, () => ({
        contents: `
          export const supabase = {
            schema: (...args) => globalThis.__reviewTransport.schema(...args),
            rpc: (...args) => globalThis.__reviewTransport.rpc(...args),
            auth: {
              onAuthStateChange: (...args) => globalThis.__reviewTransport.auth.onAuthStateChange(...args),
              getSession: (...args) => globalThis.__reviewTransport.auth.getSession(...args),
              signOut: (...args) => globalThis.__reviewTransport.auth.signOut(...args),
            }
          };
          export const isSupabaseConfigured = () => true;
        `,
        loader: 'js',
      }));
    },
  }],
});

const { TeamsPage, AuthProvider } = await import(pathToFileURL(bundlePath).href);

function visibleText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(visibleText).join(' ');
  if (node.children) return node.children.map(visibleText).join(' ');
  return '';
}

async function mount(element) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

function setupEnvironment(options = {}) {
  const items = new Map(options.initialStorageEntries || []);
  const storage = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, String(v)),
    removeItem: (k) => items.delete(k),
    clear: () => items.clear(),
    key: (i) => [...items.keys()][i] ?? null,
    get length() { return items.size; },
  };

  const windowListeners = new Map();
  globalThis.window = {
    sessionStorage: storage,
    addEventListener(evt, cb) {
      if (!windowListeners.has(evt)) windowListeners.set(evt, []);
      windowListeners.get(evt).push(cb);
    },
    removeEventListener(evt, cb) {
      const arr = windowListeners.get(evt);
      if (arr) {
        const idx = arr.indexOf(cb);
        if (idx >= 0) arr.splice(idx, 1);
      }
    },
    dispatchEvent(evt) {
      const type = typeof evt === 'string' ? evt : evt.type;
      const arr = windowListeners.get(type) || [];
      for (const cb of arr) cb(evt);
    },
  };

  const docListeners = new Map();
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener(evt, cb) {
      if (!docListeners.has(evt)) docListeners.set(evt, []);
      docListeners.get(evt).push(cb);
    },
    removeEventListener(evt, cb) {
      const arr = docListeners.get(evt);
      if (arr) {
        const idx = arr.indexOf(cb);
        if (idx >= 0) arr.splice(idx, 1);
      }
    },
    dispatchEvent(evt) {
      const type = typeof evt === 'string' ? evt : evt.type;
      const arr = docListeners.get(type) || [];
      for (const cb of arr) cb(evt);
    },
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });

  const rpcCalls = [];
  const user = options.user !== undefined ? options.user : { id: 'admin-user-id', email: 'admin@example.com' };
  const churchAccess = options.churchAccess !== undefined ? options.churchAccess : {
    church_id: 'church-1',
    church_name: 'Igreja Central',
    is_admin: true,
    status: 'active',
  };

  const executeRpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (options.rpcHandler) {
      const handled = await options.rpcHandler(name, args);
      if (handled !== undefined) return handled;
    }

    if (name === 'get_my_church_access') {
      return { data: churchAccess ? [churchAccess] : [], error: null };
    }
    if (name === 'list_church_teams') {
      return {
        data: [{
          teams: options.teams !== undefined ? options.teams : [],
        }],
        error: options.teamsError || null,
      };
    }
    if (name === 'list_church_team_roles') {
      return { data: [{ roles: [] }], error: null };
    }
    if (name === 'list_team_members') {
      return { data: [{ members: [] }], error: null };
    }

    return { data: null, error: null };
  };

  globalThis.__reviewTransport = {
    rpc: executeRpc,
    schema: () => ({ rpc: executeRpc }),
    auth: {
      onAuthStateChange: (cb) => {
        cb('SIGNED_IN', { user });
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: async () => ({ data: { session: { user } }, error: null }),
      signOut: async () => ({ error: null }),
    },
  };

  return { storage, rpcCalls };
}

describe('1. Formatação de Mensagens de Erro em Equipes (formatTeamsListErrorMessage)', () => {
  it('identifica PGRST202 / função ausente no schema cache como indisponibilidade de backend', () => {
    const err = {
      code: 'PGRST202',
      message: 'Could not find the function public.list_church_teams(p_church_id) in the schema cache',
    };
    const msg = formatTeamsListErrorMessage(err);
    assert.match(msg, /Serviço de equipes indisponível no servidor/i);
    assert.match(msg, /contrato necessário ainda não está disponível/i);
  });

  it('identifica erro 42501 como permissão insuficiente', () => {
    const err = {
      code: '42501',
      message: 'permission denied for function list_church_teams',
    };
    const msg = formatTeamsListErrorMessage(err);
    assert.match(msg, /Permissão insuficiente para consultar os ministérios e equipes/i);
  });

  it('identifica falha de conexão / transporte', () => {
    const err = new Error('Failed to fetch (network error)');
    const msg = formatTeamsListErrorMessage(err);
    assert.match(msg, /falha de conexão/i);
    assert.match(msg, /Verifique sua rede e tente novamente/i);
  });

  it('contextualiza mensagem em recarga com dados preexistentes', () => {
    const err = new Error('NetworkError when attempting to fetch resource');
    const msg = formatTeamsListErrorMessage(err, { isRefresh: true });
    assert.match(msg, /dados exibidos podem estar desatualizados/i);
  });
});

describe('2. Integração Real de Componente: TeamsPage — Distinção entre Erro e Lista Vazia', () => {
  it('2.1 Erro PGRST202 / função ausente exibe estado de erro e NÃO exibe "Nenhuma equipe cadastrada"', async (t) => {
    setupEnvironment({
      rpcHandler: async (name) => {
        if (name === 'list_church_teams') {
          return {
            data: null,
            error: {
              code: 'PGRST202',
              message: 'Could not find the function public.list_church_teams(p_church_id) in the schema cache',
            },
          };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(TeamsPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const text = visibleText(renderer.root);

    // Deve exibir o estado explícito de erro com botão de retry
    assert.match(text, /Não foi possível carregar as equipes/i);
    assert.match(text, /Serviço de equipes indisponível no servidor/i);
    assert.match(text, /Tentar novamente/i);

    // CRÍTICO: NÃO PODE exibir a mensagem falsa de lista vazia nem o convite para criar equipe
    assert.doesNotMatch(text, /Nenhuma equipe cadastrada/i, 'Erro de consulta não pode virar lista vazia');
    assert.doesNotMatch(text, /Crie o primeiro ministério ou equipe/i, 'Erro de consulta não pode convidar a criar cadastro');
  });

  it('2.2 Erro 42501 (permissão recusada) exibe aviso de permissão e NÃO exibe lista vazia', async (t) => {
    setupEnvironment({
      rpcHandler: async (name) => {
        if (name === 'list_church_teams') {
          return {
            data: null,
            error: {
              code: '42501',
              message: 'permission denied for function list_church_teams',
            },
          };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(TeamsPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const text = visibleText(renderer.root);
    assert.match(text, /Não foi possível carregar as equipes/i);
    assert.match(text, /Permissão insuficiente para consultar os ministérios e equipes/i);
    assert.doesNotMatch(text, /Nenhuma equipe cadastrada/i);
  });

  it('2.3 Falha de transporte (rede) exibe aviso de conexão e NÃO exibe lista vazia', async (t) => {
    setupEnvironment({
      rpcHandler: async (name) => {
        if (name === 'list_church_teams') {
          return {
            data: null,
            error: new Error('Failed to fetch'),
          };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(TeamsPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const text = visibleText(renderer.root);
    assert.match(text, /Não foi possível carregar as equipes/i);
    assert.match(text, /falha de conexão/i);
    assert.doesNotMatch(text, /Nenhuma equipe cadastrada/i);
  });

  it('2.4 Resposta bem-sucedida com lista vazia confirmada exibe "Nenhuma equipe cadastrada"', async (t) => {
    setupEnvironment({
      teams: [],
      rpcHandler: async (name) => {
        if (name === 'list_church_teams') {
          return {
            data: [{ teams: [] }],
            error: null,
          };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(TeamsPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const text = visibleText(renderer.root);

    // Comprova que agora sim exibe a lista vazia
    assert.match(text, /Nenhuma equipe cadastrada/i);
    assert.match(text, /Crie o primeiro ministério ou equipe/i);
    assert.doesNotMatch(text, /Não foi possível carregar as equipes/i);
  });

  it('2.5 Resposta bem-sucedida com equipes renderiza os cartões de equipe', async (t) => {
    const mockTeams = [
      {
        id: 'team-1',
        team_id: 'team-1',
        church_id: 'church-1',
        name: 'Louvor e Adoração',
        leader_name: 'Líder Davi',
        member_count: 5,
        status: 'active',
      },
    ];

    setupEnvironment({
      teams: mockTeams,
      rpcHandler: async (name) => {
        if (name === 'list_church_teams') {
          return {
            data: [{ teams: mockTeams }],
            error: null,
          };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(TeamsPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const text = visibleText(renderer.root);
    assert.match(text, /Louvor e Adoração/i);
    assert.match(text, /Líder Davi/i);
    assert.doesNotMatch(text, /Nenhuma equipe cadastrada/i);
    assert.doesNotMatch(text, /Não foi possível carregar as equipes/i);
  });

  it('2.6 Isolamento de contexto: resposta atrasada da Igreja A não contamina a Igreja B', async (t) => {
    let resolveListA;
    const promiseListA = new Promise((resolve) => {
      resolveListA = resolve;
    });

    let currentChurchAccess = {
      church_id: 'church-a',
      church_name: 'Igreja A',
      is_admin: true,
      status: 'active',
    };

    setupEnvironment({
      rpcHandler: async (name, args) => {
        if (name === 'get_my_church_access') {
          return { data: [currentChurchAccess], error: null };
        }
        if (name === 'list_church_teams') {
          if (args?.p_church_id === 'church-a') {
            await promiseListA;
            return {
              data: [{
                teams: [{
                  id: 'team-a',
                  name: 'Equipe da Igreja A',
                  status: 'active',
                }],
              }],
              error: null,
            };
          }
          if (args?.p_church_id === 'church-b') {
            return {
              data: [{
                teams: [{
                  id: 'team-b',
                  name: 'Equipe da Igreja B',
                  status: 'active',
                }],
              }],
              error: null,
            };
          }
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(TeamsPage)));
    t.after(() => act(() => renderer.unmount()));

    // Aguarda início da carga em A
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    // Muda contexto vivo para Igreja B
    currentChurchAccess = {
      church_id: 'church-b',
      church_name: 'Igreja B',
      is_admin: true,
      status: 'active',
    };

    await act(async () => {
      globalThis.window.dispatchEvent({ type: 'focus' });
      await new Promise((r) => setTimeout(r, 60));
    });

    // Comprova que Igreja B carregou sua equipe
    let text = visibleText(renderer.root);
    assert.match(text, /Equipe da Igreja B/i);

    // Agora resolve a resposta atrasada de A
    await act(async () => {
      resolveListA();
      await new Promise((r) => setTimeout(r, 60));
    });

    // Comprova que a resposta de A foi descartada
    text = visibleText(renderer.root);
    assert.match(text, /Equipe da Igreja B/i);
    assert.doesNotMatch(text, /Equipe da Igreja A/i, 'A resposta atrasada da Igreja A não pode contaminar a Igreja B');
  });
});

describe('3. Seleção de Funções Técnicas e Vínculo Automático de Aptidões', () => {
  it('3.1 Renderiza aptidões existentes do membro e permite alternar seleção de funções técnicas', async (t) => {
    let rpcCalls = [];
    setupEnvironment({
      teams: [{ id: 'team-louvor', name: 'Louvor', status: 'active', member_count: 1 }],
      rpcHandler: async (name, args) => {
        rpcCalls.push({ name, args });
        if (name === 'list_church_team_roles') {
          return {
            data: [{
              roles: [
                { id: 'role-vocal-solo', name: 'Vocal Solo' },
                { id: 'role-back-vocal', name: 'Back vocal' },
              ],
            }],
            error: null,
          };
        }
        if (name === 'list_team_members') {
          return {
            data: [{
              members: [
                { id: 'member-danilo', member_id: 'member-danilo', display_name: 'Danilo Gomes Nolêto' },
              ],
            }],
            error: null,
          };
        }
        if (name === 'list_member_qualifications') {
          return {
            data: [{
              qualifications: [
                {
                  id: 'qual-1',
                  member_id: 'member-danilo',
                  team_id: 'team-louvor',
                  team_role_id: 'role-vocal-solo',
                  role_name: 'Vocal Solo',
                  status: 'active',
                },
              ],
            }],
            error: null,
          };
        }
        if (name === 'list_church_members_admin') {
          return {
            data: [{
              items: [
                { member_id: 'member-danilo', display_name: 'Danilo Gomes Nolêto' },
                { member_id: 'member-joao', display_name: 'João d\'Ávila' },
              ],
            }],
            error: null,
          };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(TeamsPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // Clica no card da equipe Louvor para abrir detalhes
    const teamCard = renderer.root.findAll((node) => {
      return node.props && node.props.className === 'card' && visibleText(node).includes('Louvor');
    })[0];
    assert.ok(teamCard, 'Card da equipe Louvor deve existir');

    await act(async () => {
      teamCard.props.onClick();
      await new Promise((r) => setTimeout(r, 60));
    });

    let text = visibleText(renderer.root);

    // 1. Deve exibir Danilo com seu badge de aptidão "Vocal Solo"
    assert.match(text, /Danilo Gomes Nolêto/i);
    assert.match(text, /Vocal Solo/i);
    assert.match(text, /Nenhuma selecionada/i);
    assert.match(text, /Vincular/i);

    // 2. Localiza botão da função "Vocal Solo" e clica para selecionar
    const vocalSoloBtn = renderer.root.findAll((node) => {
      return node.type === 'button' && visibleText(node).includes('Vocal Solo');
    })[0];
    assert.ok(vocalSoloBtn, 'Botão Vocal Solo deve existir');

    await act(async () => {
      vocalSoloBtn.props.onClick();
    });

    text = visibleText(renderer.root);
    assert.match(text, /1 selecionada\(s\) para vincular/i);
    assert.match(text, /Função técnica a vincular:.*Vocal Solo/i);
    assert.match(text, /Vincular com Função/i);

    // 3. Clica na função "Back vocal" para multi-seleção
    const backVocalBtn = renderer.root.findAll((node) => {
      return node.type === 'button' && visibleText(node).includes('Back vocal');
    })[0];
    assert.ok(backVocalBtn, 'Botão Back vocal deve existir');

    await act(async () => {
      backVocalBtn.props.onClick();
    });

    text = visibleText(renderer.root);
    assert.match(text, /2 selecionada\(s\) para vincular/i);

    // 4. Clica novamente em "Vocal Solo" para desmarcar (resta apenas Back vocal)
    await act(async () => {
      vocalSoloBtn.props.onClick();
    });

    text = visibleText(renderer.root);
    assert.match(text, /1 selecionada\(s\) para vincular/i);
    assert.match(text, /Função técnica a vincular:.*Back vocal/i);
  });

  it('3.2 Ao cadastrar nova função técnica ela já vem selecionada e vincular membro homologa a aptidão automaticamente', async (t) => {
    let rpcCalls = [];
    let currentRoles = [];
    let currentMembers = [];
    let currentQuals = [];

    setupEnvironment({
      teams: [{ id: 'team-louvor', name: 'Louvor', status: 'active', member_count: 0 }],
      rpcHandler: async (name, args) => {
        rpcCalls.push({ name, args });
        if (name === 'list_church_team_roles') {
          return { data: [{ roles: currentRoles }], error: null };
        }
        if (name === 'list_team_members') {
          return { data: [{ members: currentMembers }], error: null };
        }
        if (name === 'list_member_qualifications') {
          return { data: [{ qualifications: currentQuals.filter((q) => q.member_id === args?.p_member_id) }], error: null };
        }
        if (name === 'list_church_members_admin') {
          return {
            data: [{
              items: [
                { member_id: 'member-danilo', display_name: 'Danilo Gomes Nolêto' },
                { member_id: 'member-joao', display_name: 'João d\'Ávila' },
                { member_id: 'member-rec02', display_name: 'Recuperação 02' },
              ],
            }],
            error: null,
          };
        }
        if (name === 'create_team_role') {
          const newId = args?.p_name === 'Vocal Solo' ? 'role-vocal' : 'role-back';
          currentRoles.push({ id: newId, name: args.p_name });
          return {
            data: [{
              command_id: args.p_command_id,
              action: 'create_team_role',
              church_id: args.p_church_id,
              result_entity_id: newId,
              result_payload: { role_id: newId, name: args.p_name },
              created_at: new Date().toISOString(),
            }],
            error: null,
          };
        }
        if (name === 'add_team_member') {
          const mName = args.p_member_id === 'member-danilo' ? 'Danilo Gomes Nolêto' : 'Recuperação 02';
          const memId = crypto.randomUUID();
          currentMembers.push({ id: args.p_member_id, member_id: args.p_member_id, display_name: mName });
          return {
            data: [{
              command_id: args.p_command_id,
              action: 'add_team_member',
              church_id: args.p_church_id,
              result_entity_id: memId,
              result_payload: { membership_id: memId, member_id: args.p_member_id },
              created_at: new Date().toISOString(),
            }],
            error: null,
          };
        }
        if (name === 'grant_member_qualification') {
          const qualId = crypto.randomUUID();
          currentQuals.push({
            id: qualId,
            member_id: args.p_member_id,
            team_id: args.p_team_id,
            team_role_id: args.p_team_role_id,
            role_name: args.p_team_role_id === 'role-vocal' ? 'Vocal Solo' : 'Back vocal',
            status: 'active',
          });
          return {
            data: [{
              command_id: args.p_command_id,
              action: 'grant_member_qualification',
              church_id: args.p_church_id,
              result_entity_id: qualId,
              result_payload: { qualification_id: qualId, member_id: args.p_member_id, team_role_id: args.p_team_role_id },
              created_at: new Date().toISOString(),
            }],
            error: null,
          };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(TeamsPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // Abre detalhes da equipe
    const teamCard = renderer.root.findAll((node) => node.props?.className === 'card' && visibleText(node).includes('Louvor'))[0];
    await act(async () => {
      teamCard.props.onClick();
      await new Promise((r) => setTimeout(r, 60));
    });

    // 1. Cadastra "Vocal Solo"
    const roleInput = renderer.root.findAll((node) => node.type === 'input' && node.props?.placeholder?.includes('Vocal Solo'))[0];
    const roleForm = renderer.root.findAll((node) => node.type === 'form' && visibleText(node).includes('Adicionar Função'))[0];

    await act(async () => {
      roleInput.props.onChange({ target: { value: 'Vocal Solo' } });
    });
    await act(async () => {
      roleForm.props.onSubmit({ preventDefault: () => {} });
      await new Promise((r) => setTimeout(r, 60));
    });

    // "Vocal Solo" deve vir automaticamente selecionado
    let text = visibleText(renderer.root);
    assert.match(text, /Função técnica "Vocal Solo" cadastrada!/i);
    assert.match(text, /1 selecionada\(s\) para vincular/i);
    assert.match(text, /Função técnica a vincular:.*Vocal Solo/i);

    // 2. Vincula Danilo Gomes Nolêto
    const memberSelect = renderer.root.findAll((node) => node.type === 'select' && visibleText(node).includes('Selecione um membro'))[0];
    const memberForm = renderer.root.findAll((node) => node.type === 'form' && visibleText(node).includes('Vincular'))[0];

    await act(async () => {
      memberSelect.props.onChange({ target: { value: 'member-danilo' } });
    });
    await act(async () => {
      memberForm.props.onSubmit({ preventDefault: () => {} });
      await new Promise((r) => setTimeout(r, 60));
    });

    // Comprova que Danilo foi vinculado E grant_member_qualification foi chamado para role-vocal!
    const grantCalls = rpcCalls.filter((c) => c.name === 'grant_member_qualification');
    assert.strictEqual(grantCalls.length, 1, 'grant_member_qualification deve ter sido disparado 1 vez');
    assert.strictEqual(grantCalls[0].args.p_member_id, 'member-danilo');
    assert.strictEqual(grantCalls[0].args.p_team_role_id, 'role-vocal');

    // 3. Cadastra segunda função técnica: "Back vocal"
    const freshRoleInput = renderer.root.findAll((node) => node.type === 'input' && node.props?.placeholder?.includes('Vocal Solo'))[0];
    const freshRoleForm = renderer.root.findAll((node) => node.type === 'form' && visibleText(node).includes('Adicionar Função'))[0];

    await act(async () => {
      freshRoleInput.props.onChange({ target: { value: 'Back vocal' } });
    });
    await act(async () => {
      freshRoleForm.props.onSubmit({ preventDefault: () => {} });
      await new Promise((r) => setTimeout(r, 60));
    });

    // A primeira função (Vocal Solo) deve ser desmarcada e selecionada APENAS a nova (Back vocal)
    text = visibleText(renderer.root);
    assert.match(text, /Função técnica "Back vocal" cadastrada!/i);
    assert.match(text, /1 selecionada\(s\) para vincular/i);
    assert.match(text, /Função técnica a vincular:.*Back vocal/i);
    assert.doesNotMatch(text, /Função técnica a vincular:.*Vocal Solo/i, 'Vocal Solo deve ter sido desmarcado automaticamente');

    // 4. Vincula Recuperação 02 com a nova função
    const freshMemberSelect = renderer.root.findAll((node) => node.type === 'select' && visibleText(node).includes('Selecione um membro'))[0];
    const freshMemberForm = renderer.root.findAll((node) => node.type === 'form' && visibleText(node).includes('Vincular'))[0];

    await act(async () => {
      freshMemberSelect.props.onChange({ target: { value: 'member-rec02' } });
    });
    await act(async () => {
      freshMemberForm.props.onSubmit({ preventDefault: () => {} });
      await new Promise((r) => setTimeout(r, 60));
    });

    // Comprova que Recuperação 02 recebeu role-back
    const secondGrantCalls = rpcCalls.filter((c) => c.name === 'grant_member_qualification');
    assert.strictEqual(secondGrantCalls.length, 2, 'grant_member_qualification deve ter sido disparado 2 vezes no total');
    assert.strictEqual(secondGrantCalls[1].args.p_member_id, 'member-rec02');
    assert.strictEqual(secondGrantCalls[1].args.p_team_role_id, 'role-back');

    // Comprova que a lista agora exibe cada integrante com sua respectiva função diferente
    text = visibleText(renderer.root);
    assert.match(text, /Danilo Gomes Nolêto/i);
    assert.match(text, /Recuperação 02/i);
  });

  it('3.3 Exibe "Selecionar Líder" quando ministério não tem líder e "Transferir Liderança" quando já possui líder', async (t) => {
    let rpcCalls = [];
    let currentLeaderId = null;
    let currentLeaderName = null;

    setupEnvironment({
      teams: [{ id: 'team-midia', name: 'Mídia & Comunicação', leader_member_id: null, leader_name: null, member_count: 0 }],
      rpcHandler: async (name, args) => {
        rpcCalls.push({ name, args });
        if (name === 'list_church_teams') {
          return {
            data: [{
              teams: [{
                id: 'team-midia',
                name: 'Mídia & Comunicação',
                leader_member_id: currentLeaderId,
                leader_name: currentLeaderName,
                member_count: currentLeaderId ? 1 : 0,
              }],
            }],
            error: null,
          };
        }
        if (name === 'list_church_members_admin') {
          return {
            data: [{
              items: [
                { member_id: 'member-danilo', display_name: 'Danilo Gomes Nolêto' },
              ],
            }],
            error: null,
          };
        }
        if (name === 'assign_team_leader') {
          currentLeaderId = args.p_new_leader_member_id;
          currentLeaderName = 'Danilo Gomes Nolêto';
          return {
            data: [{
              command_id: args.p_command_id,
              action: 'assign_team_leader',
              church_id: args.p_church_id,
              result_entity_id: args.p_team_id,
              result_payload: { team_id: args.p_team_id, leader_member_id: args.p_new_leader_member_id },
              created_at: new Date().toISOString(),
            }],
            error: null,
          };
        }
      },
    });

    const renderer = await mount(React.createElement(AuthProvider, null, React.createElement(TeamsPage)));
    t.after(() => act(() => renderer.unmount()));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // Clica na equipe Mídia & Comunicação
    const teamCard = renderer.root.findAll((node) => node.props?.className === 'card' && visibleText(node).includes('Mídia & Comunicação'))[0];
    await act(async () => {
      teamCard.props.onClick();
      await new Promise((r) => setTimeout(r, 60));
    });

    // Como a equipe não tem líder, o botão DEVE ser "Selecionar Líder"
    let text = visibleText(renderer.root);
    assert.match(text, /Selecionar Líder/i, 'Deve exibir "Selecionar Líder" quando a equipe ainda não tem líder');
    assert.doesNotMatch(text, /Transferir Liderança/i, 'NÃO deve exibir "Transferir Liderança" se não há líder anterior');

    // Abre modal de seleção de líder
    const selectLeaderBtn = renderer.root.findAll((node) => node.type === 'button' && visibleText(node).includes('Selecionar Líder'))[0];
    await act(async () => {
      selectLeaderBtn.props.onClick();
      await new Promise((r) => setTimeout(r, 60));
    });

    text = visibleText(renderer.root);
    assert.match(text, /Selecionar Líder: Mídia & Comunicação/i);
    assert.match(text, /Esta equipe ainda não possui líder/i);
    assert.match(text, /Confirmar Líder/i);

    // Seleciona Danilo e confirma
    const leaderSelect = renderer.root.findAll((node) => node.type === 'select' && visibleText(node).includes('Selecione o líder...'))[0];
    const leaderForm = renderer.root.findAll((node) => node.type === 'form' && visibleText(node).includes('Confirmar Líder'))[0];

    await act(async () => {
      leaderSelect.props.onChange({ target: { value: 'member-danilo' } });
    });
    await act(async () => {
      leaderForm.props.onSubmit({ preventDefault: () => {} });
      await new Promise((r) => setTimeout(r, 60));
    });

    // Agora que a equipe tem líder, o botão deve mudar para "Transferir Liderança"
    text = visibleText(renderer.root);
    assert.match(text, /Líder da equipe selecionado com sucesso!/i);
    assert.match(text, /Transferir Liderança/i, 'Agora deve exibir "Transferir Liderança" pois a equipe já tem líder');
  });
});


