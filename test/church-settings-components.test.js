import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { validateChurchSettings, validateChurchLogo, settingsStorageKey, MAX_LOGO_BYTES } from '../src/utils/churchSettingsService.js';

const bundle = path.resolve('node_modules/.cache/church-settings-components.mjs');
fs.mkdirSync(path.dirname(bundle), { recursive: true });
await build({
  stdin: { contents: `export {default as Settings} from './src/components/ChurchSettingsPage.jsx'; export {default as Home} from './src/components/ChurchHomePage.jsx';`, resolveDir: process.cwd(), loader: 'jsx' },
  outfile: bundle, bundle: true, format: 'esm', platform: 'node', external: ['react', 'react-dom', 'lucide-react'],
  plugins: [{ name: 'settings-transport', setup(builder) {
    builder.onResolve({ filter: /AuthContext$/ }, () => ({ path: 'auth', namespace: 'settings' }));
    builder.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'transport', namespace: 'settings' }));
    builder.onLoad({ filter: /.*/, namespace: 'settings' }, ({ path: name }) => ({
      contents: name === 'auth' ? 'export const useAuth = () => globalThis.__settingsAuth;'
        : `export const supabase = {schema: () => ({rpc: (...args) => globalThis.__settingsRpc(...args)}), storage: {from: () => globalThis.__settingsStorage}};`, loader: 'js',
    }));
  } }],
});
const { Settings, Home } = await import(pathToFileURL(bundle).href);
const churchId = '01700000-0000-4000-8000-000000000001';
const original = { church_id: churchId, name: 'Igreja Teste', timezone: 'America/Sao_Paulo', address: 'Rua anterior', google_maps_url: 'https://maps.app.goo.gl/teste', logo_path: null, profile_revision: 0 };
let renderer;
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
function setup({ admin = true, rpc } = {}) {
  const values = new Map();
  const calls = [];
  const storageCalls = [];
  const profile = { ...original };
  globalThis.window = { sessionStorage: {
    getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k),
  }, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  URL.createObjectURL = () => 'blob:test-logo';
  URL.revokeObjectURL = () => {};
  globalThis.__settingsAuth = {
    session: { user: { id: 'admin-test' } }, sessionId: 1,
    churchAccess: { church_id: churchId, church_name: original.name, is_admin: admin },
    getAuthSnapshot: () => ({ userId: globalThis.__settingsAuth.session?.user?.id,
      sessionId: globalThis.__settingsAuth.sessionId, churchId: globalThis.__settingsAuth.churchAccess?.church_id,
      churchAccess: globalThis.__settingsAuth.churchAccess }),
    reloadChurchAccess: async (targetChurchId, opts) => {
      if (globalThis.__settingsAuth.churchAccess) {
        globalThis.__settingsAuth.churchAccess = {
          ...globalThis.__settingsAuth.churchAccess,
          church_name: profile.name,
        };
      }
      return { success: true };
    },
  };
  globalThis.__settingsStorage = {
    upload: async (...args) => { storageCalls.push(args); return { error: null }; },
    createSignedUrl: async () => ({ data: { signedUrl: 'https://example.invalid/signed-logo' }, error: null }),
  };
  globalThis.__settingsRpc = async (name, params) => {
    calls.push({ name, params });
    if (rpc) { const result = rpc(name, params, values); if (result !== undefined) return result; }
    if (name === 'get_church_settings') return { data: [{ ...profile }], error: null };
    if (name === 'get_church_logo') return { data: [{ logo_path: null }], error: null };
    if (name === 'check_church_creation_eligibility') return { data: [{ eligible: false }], error: null };
    if (name === 'update_church_settings') {
      Object.assign(profile, {
        name: params.p_name !== undefined ? params.p_name : profile.name,
        address: params.p_address,
        google_maps_url: params.p_google_maps_url,
        logo_path: params.p_logo_path,
        profile_revision: params.p_expected_revision + 1,
      });
      return { data: [{ church_id: churchId, command_id: params.p_command_id, profile_revision: profile.profile_revision }], error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  };
  return { values, calls, storageCalls };
}
async function mount(Component = Settings) {
  await act(async () => { renderer = TestRenderer.create(React.createElement(Component, { onBack() {} })); });
  return renderer;
}
async function unmount() { if (renderer) { await act(async () => renderer.unmount()); renderer = null; } }
function text(node) {
  if (arguments.length === 0) node = renderer.toJSON();
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(text).join(' ');
  return text(node.children ?? node.props?.children);
}
async function click(label) {
  const button = renderer.root.findAllByType('button').find((b) => text(b.props.children).includes(label));
  assert.ok(button, `Botão ${label}`);
  await act(async () => { await button.props.onClick(); });
}
async function submit() { await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); }); }

test('validação bloqueia host enganoso, credenciais, protocolo inseguro e arquivos fora do limite', () => {
  for (const url of ['https://google.com.evil.test/maps/a', 'https://google.com/mapsfake', 'https://user:pass@google.com/maps/a', 'http://maps.app.goo.gl/a', 'https://maps.app.goo.gl:444/a', 'javascript:alert(1)']) {
    assert.ok(validateChurchSettings({ googleMapsUrl: url }).errors.googleMapsUrl, url);
  }
  for (const url of ['https://www.google.com.br/maps/place/Igreja', 'https://maps.app.goo.gl/abc', 'https://maps.google.com/?q=igreja']) {
    assert.deepEqual(validateChurchSettings({ googleMapsUrl: url }).errors, {});
  }
  assert.ok(validateChurchLogo({ type: 'image/svg+xml', size: 100 }));
  assert.ok(validateChurchLogo({ type: 'image/png', size: MAX_LOGO_BYTES + 1 }));
  assert.equal(validateChurchLogo({ type: 'image/png', size: MAX_LOGO_BYTES }), null);
});

test('navegação oferece cadastro somente ao administrador e carrega dados existentes', async () => {
  try {
    setup(); await mount(Home);
    await act(async () => renderer.root.findByProps({ id: 'btn-goto-church-settings' }).props.onClick());
    assert.equal(renderer.root.findByProps({ id: 'church-settings-address' }).props.value, 'Rua anterior');
    assert.match(text(), /Igreja Teste/);
    await unmount();
    const { calls } = setup({ admin: false }); await mount(Home);
    assert.equal(renderer.root.findAllByProps({ id: 'btn-goto-church-settings' }).length, 0);
    assert.equal(calls.some((c) => c.name === 'get_church_settings'), false);
    await unmount(); await mount();
    assert.match(text(), /exclusivo de administradores/);
    assert.equal(calls.some((c) => c.name === 'get_church_settings'), false);
  } finally { await unmount(); }
});

test('salvamento retém o comando antes do RPC e confirma apenas recibo correspondente', async () => {
  try {
    const { values, calls } = setup({ rpc(name, params, stored) {
      if (name === 'update_church_settings') assert.equal(JSON.parse(stored.get(settingsStorageKey('admin-test', churchId))).commandId, params.p_command_id);
    } });
    await mount();
    await act(async () => renderer.root.findByProps({ id: 'church-settings-address' }).props.onChange({ target: { value: 'Rua corrigida' } }));
    await submit();
    const command = calls.find((c) => c.name === 'update_church_settings').params;
    assert.equal(command.p_name, 'Igreja Teste');
    assert.equal(command.p_address, 'Rua corrigida');
    assert.equal(command.p_expected_revision, 0);
    assert.equal(command.p_user_id, undefined);
    assert.equal(command.p_is_admin, undefined);
    assert.equal(values.has(settingsStorageKey('admin-test', churchId)), false);
    assert.match(text(), /Alterações salvas com sucesso/);
  } finally { await unmount(); }
});

test('resposta perdida bloqueia novas edições e reenvia exatamente o mesmo comando', async () => {
  let attempts = 0;
  try {
    const { calls, values } = setup({ rpc(name) {
      if (name === 'update_church_settings' && ++attempts === 1) return { data: null, error: { message: 'Failed to fetch' } };
    } });
    await mount(); await submit();
    assert.equal(renderer.root.findByType('fieldset').props.disabled, true);
    assert.ok(values.has(settingsStorageKey('admin-test', churchId)));
    await click('Verificar salvamento');
    const commands = calls.filter((c) => c.name === 'update_church_settings');
    assert.equal(commands.length, 2);
    assert.deepEqual(commands[0].params, commands[1].params);
    assert.match(text(), /Alterações salvas com sucesso/);
  } finally { await unmount(); }
});

test('conflito exige recarga; perda de administração remove o formulário e seus dados', async () => {
  try {
    setup({ rpc: (name) => name === 'update_church_settings' ? { error: { code: '40001' } } : undefined });
    await mount(); await submit();
    assert.match(text(), /Outra pessoa atualizou/);
    assert.equal(renderer.root.findByType('fieldset').props.disabled, true);
    await click('Recarregar dados');
    assert.equal(renderer.root.findByType('fieldset').props.disabled, false);
    await unmount();
    setup({ rpc: (name) => name === 'update_church_settings' ? { error: { code: '42501' } } : undefined });
    await mount(); await submit();
    assert.equal(renderer.root.findAllByType('form').length, 0);
    assert.doesNotMatch(text(), /Rua anterior/);
  } finally { await unmount(); }
});

test('troca de sessão durante salvamento descarta confirmação da sessão anterior', async () => {
  const response = deferred();
  try {
    const { values } = setup({ rpc: (name) => name === 'update_church_settings' ? response.promise : undefined });
    await mount();
    let promise;
    act(() => { promise = renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    const command = JSON.parse(values.get(settingsStorageKey('admin-test', churchId)));
    globalThis.__settingsAuth = { ...globalThis.__settingsAuth, sessionId: 2 };
    await act(async () => {
      renderer.update(React.createElement(Settings, { onBack() {} }));
      response.resolve({ data: [{ church_id: churchId, command_id: command.commandId, profile_revision: 1 }] });
      await promise;
    });
    assert.doesNotMatch(text(), /Alterações salvas com sucesso/);
    assert.ok(values.has(settingsStorageKey('admin-test', churchId)));
  } finally { await unmount(); }
});

test('envio da logo usa caminho da igreja e sem sobrescrita; erro no upload impede salvar cadastro', async () => {
  try {
    const { storageCalls, calls } = setup(); await mount();
    await act(async () => renderer.root.findByProps({ id: 'church-settings-logo' }).props.onChange({ target: { files: [{ type: 'image/png', size: 500 }] } }));
    await submit();
    assert.ok(storageCalls[0][0].startsWith(`${churchId}/`));
    assert.equal(storageCalls[0][2].upsert, false);
    assert.equal(calls.find((c) => c.name === 'update_church_settings').params.p_logo_path, storageCalls[0][0]);
    await unmount();
    const failed = setup();
    globalThis.__settingsStorage.upload = async () => ({ error: { message: 'denied' } });
    await mount();
    await act(async () => renderer.root.findByProps({ id: 'church-settings-logo' }).props.onChange({ target: { files: [{ type: 'image/png', size: 500 }] } }));
    await submit();
    assert.equal(failed.calls.some((c) => c.name === 'update_church_settings'), false);
    assert.match(text(), /Nenhuma alteração no cadastro foi salva/);
  } finally { await unmount(); }
});

test('ambiente sem RPC informa indisponibilidade; recibo malformado permanece pendente', async () => {
  try {
    setup({ rpc: (name) => name === 'get_church_settings' ? { error: { code: 'PGRST202' } } : undefined });
    await mount(); assert.match(text(), /ainda não foi habilitada/);
    assert.equal(renderer.root.findAllByType('form').length, 0);
    await unmount();
    const { values } = setup({ rpc: (name) => name === 'update_church_settings' ? { data: [{ church_id: churchId, command_id: 'outro', profile_revision: 1 }] } : undefined });
    await mount(); await submit();
    assert.doesNotMatch(text(), /Alterações salvas com sucesso/);
    assert.ok(values.has(settingsStorageKey('admin-test', churchId)));
  } finally { await unmount(); }
});

test('reabrir a tela recupera comando incerto sem criar outro ID ou repetir upload', async () => {
  let attempts = 0;
  try {
    const { calls, values, storageCalls } = setup({ rpc(name) {
      if (name === 'update_church_settings' && ++attempts === 1) return { error: { message: 'network lost' } };
    } });
    await mount(); await submit();
    const retained = values.get(settingsStorageKey('admin-test', churchId));
    await unmount(); await mount();
    assert.equal(renderer.root.findByType('fieldset').props.disabled, true);
    await click('Verificar salvamento');
    assert.equal(calls.filter((c) => c.name === 'update_church_settings')[1].params.p_command_id, JSON.parse(retained).commandId);
    assert.equal(storageCalls.length, 0);
    assert.match(text(), /Alterações salvas com sucesso/);
  } finally { await unmount(); }
});

test('falha do armazenamento local impede envio; dois cliques não duplicam uma chamada em voo', async () => {
  try {
    const { calls } = setup();
    window.sessionStorage.setItem = () => { throw new Error('QuotaExceeded'); };
    await mount(); await submit();
    assert.equal(calls.some((c) => c.name === 'update_church_settings'), false);
    await unmount();
    const response = deferred();
    const fixture = setup({ rpc: (name) => name === 'update_church_settings' ? response.promise : undefined });
    await mount();
    let first;
    act(() => { first = renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    await submit();
    assert.equal(fixture.calls.filter((c) => c.name === 'update_church_settings').length, 1);
    const command = fixture.calls.find((c) => c.name === 'update_church_settings').params;
    await act(async () => {
      response.resolve({ data: [{ church_id: churchId, command_id: command.p_command_id, profile_revision: 1 }] });
      await first;
    });
  } finally { await unmount(); }
});

test('resposta de leitura da igreja anterior não contamina o novo contexto', async () => {
  const oldResponse = deferred();
  const otherId = '01700000-0000-4000-8000-000000000002';
  try {
    setup({ rpc(name, params) {
      if (name !== 'get_church_settings') return;
      if (params.p_church_id === churchId) return oldResponse.promise;
      return { data: [{ ...original, church_id: otherId, name: 'Igreja nova', address: 'Endereço novo' }] };
    } });
    await mount();
    globalThis.__settingsAuth = { ...globalThis.__settingsAuth, churchAccess: { church_id: otherId, is_admin: true } };
    await act(async () => renderer.update(React.createElement(Settings, { onBack() {} })));
    await act(async () => oldResponse.resolve({ data: [{ ...original }] }));
    assert.equal(renderer.root.findByProps({ id: 'church-settings-address' }).props.value, 'Endereço novo');
    assert.doesNotMatch(text(), /Igreja Teste/);
  } finally { await unmount(); }
});


test('logo lenta ou indisponível não bloqueia edição do cadastro confirmado', async () => {
  const signed = deferred();
  try {
    setup({ rpc: (name) => name === 'get_church_settings'
      ? { data: [{ ...original, logo_path: `${churchId}/logo.png` }] } : undefined });
    globalThis.__settingsStorage.createSignedUrl = () => signed.promise;
    await mount();
    assert.equal(renderer.root.findByType('fieldset').props.disabled, false);
    assert.equal(renderer.root.findByProps({ id: 'church-settings-address' }).props.value, original.address);
    assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Carregando logo' }).length, 1);
    await act(async () => signed.resolve({ error: { message: 'network' } }));
    assert.match(text(), /ela continua salva/);
    assert.equal(renderer.root.findByType('fieldset').props.disabled, false);
  } finally { await unmount(); }
});

test('consulta inicial usa esqueleto; erro pode ser recuperado sem formulário vazio', async () => {
  const response = deferred();
  let failed = true;
  try {
    const { calls } = setup({ rpc: (name) => name === 'get_church_settings' && failed ? response.promise : undefined });
    await mount();
    assert.equal(renderer.root.findAllByType('form').length, 0);
    assert.match(text(), /Carregando dados da igreja/);
    await act(async () => response.resolve({ error: { message: 'network failed' } }));
    assert.match(text(), /Não foi possível conectar/);
    assert.equal(renderer.root.findAllByType('form').length, 0);
    assert.equal(calls.some((c) => c.name === 'update_church_settings'), false);
    failed = false;
    await click('Tentar novamente');
    assert.equal(renderer.root.findByType('fieldset').props.disabled, false);
  } finally { await unmount(); }
});

test('respostas incompletas não viram campos vazios; ausência é distinta de falha', async () => {
  try {
    for (const data of [null, [null], [{}], [{ ...original, address: undefined }], [original, original]]) {
      setup({ rpc: (name) => name === 'get_church_settings' ? { data } : undefined });
      await mount();
      assert.equal(renderer.root.findAllByType('form').length, 0);
      assert.match(text(), /Não foi possível carregar/);
      await unmount();
    }
    setup({ rpc: (name) => name === 'get_church_settings' ? { data: [] } : undefined });
    await mount();
    assert.match(text(), /Cadastro da igreja não encontrado/);
    assert.equal(renderer.root.findAllByType('form').length, 0);
  } finally { await unmount(); }
});

test('falha na recarga conserva campos, bloqueia nova gravação e permite recuperação', async () => {
  let failRead = false;
  try {
    const { calls } = setup({ rpc: (name) => name === 'get_church_settings' && failRead
      ? { error: { message: 'network failed' } } : undefined });
    await mount();
    failRead = true;
    await click('Recarregar dados');
    assert.equal(renderer.root.findByProps({ id: 'church-settings-address' }).props.value, original.address);
    assert.equal(renderer.root.findByType('fieldset').props.disabled, true);
    await submit();
    assert.equal(calls.some((c) => c.name === 'update_church_settings'), false);
    failRead = false;
    await click('Tentar novamente');
    assert.equal(renderer.root.findByType('fieldset').props.disabled, false);
  } finally { await unmount(); }
});

test('recibo confirmado com recarga falha não anuncia sucesso da tela nem permite nova edição', async () => {
  let saved = false;
  try {
    setup({ rpc(name) {
      if (name === 'update_church_settings') saved = true;
      if (name === 'get_church_settings' && saved) return { error: { message: 'network' } };
    } });
    await mount(); await submit();
    assert.doesNotMatch(text(), /Alterações salvas com sucesso/);
    assert.match(text(), /edição fica bloqueada/);
    assert.equal(renderer.root.findByType('fieldset').props.disabled, true);
  } finally { await unmount(); }
});

test('nova sessão não herda erro de acesso nem logo pendente da sessão anterior', async () => {
  const oldLogo = deferred();
  try {
    setup({ rpc: (name) => name === 'get_church_settings'
      ? { data: [{ ...original, logo_path: `${churchId}/old.png` }] } : undefined });
    globalThis.__settingsStorage.createSignedUrl = () => oldLogo.promise;
    await mount();
    globalThis.__settingsAuth = { ...globalThis.__settingsAuth, sessionId: 2 };
    globalThis.__settingsRpc = async () => ({ data: [{ ...original, address: 'Nova sessão' }] });
    await act(async () => renderer.update(React.createElement(Settings, { onBack() {} })));
    await act(async () => oldLogo.resolve({ data: { signedUrl: 'https://example.invalid/old' } }));
    assert.equal(renderer.root.findByProps({ id: 'church-settings-address' }).props.value, 'Nova sessão');
    assert.equal(renderer.root.findAllByType('img').length, 0);
    await unmount();
    let forbidden = true;
    setup({ rpc: (name) => name === 'get_church_settings' && forbidden ? { error: { code: '42501' } } : undefined });
    await mount();
    assert.match(text(), /Acesso Restrito/);
    forbidden = false;
    globalThis.__settingsAuth = { ...globalThis.__settingsAuth, sessionId: 3 };
    await act(async () => renderer.update(React.createElement(Settings, { onBack() {} })));
    assert.equal(renderer.root.findByType('fieldset').props.disabled, false);
  } finally { await unmount(); }
});

test('CA02: campo de nome editável valida obrigatoriedade, trim, normalização NFC e limite de 160 caracteres', async () => {
  try {
    const { calls } = setup();
    await mount();
    const nameInput = renderer.root.findByProps({ id: 'church-settings-name' });
    assert.equal(nameInput.props.value, 'Igreja Teste');

    // Validação unitária direta no helper de serviço
    assert.ok(validateChurchSettings({ name: '' }).errors.name);
    assert.ok(validateChurchSettings({ name: '   ' }).errors.name);
    assert.ok(validateChurchSettings({ name: 'A'.repeat(161) }).errors.name);
    assert.equal(validateChurchSettings({ name: '  Comunidade do Reino  ' }).data.name, 'Comunidade do Reino');

    // Submissão com nome vazio bloqueia envio no formulário
    await act(async () => nameInput.props.onChange({ target: { value: '   ' } }));
    await submit();
    assert.match(text(), /Nome da igreja é obrigatório/);
    assert.equal(calls.some((c) => c.name === 'update_church_settings'), false);

    // Submissão com mais de 160 caracteres bloqueia envio
    await act(async () => nameInput.props.onChange({ target: { value: 'A'.repeat(161) } }));
    await submit();
    assert.match(text(), /não pode exceder 160 caracteres|deve ter entre 1 e 160 caracteres/);
    assert.equal(calls.some((c) => c.name === 'update_church_settings'), false);
  } finally { await unmount(); }
});

test('CA03: salvamento com sucesso atualiza nome na tela e sincroniza contexto global da igreja', async () => {
  try {
    const { calls } = setup();
    await mount();
    const nameInput = renderer.root.findByProps({ id: 'church-settings-name' });
    await act(async () => nameInput.props.onChange({ target: { value: '  Nova Igreja Betel  ' } }));
    await submit();

    const command = calls.find((c) => c.name === 'update_church_settings').params;
    assert.equal(command.p_name, 'Nova Igreja Betel');
    assert.match(text(), /Alterações salvas com sucesso/);

    // Contexto global (churchAccess.church_name) atualizado sem relogin
    assert.equal(globalThis.__settingsAuth.churchAccess.church_name, 'Nova Igreja Betel');
    assert.equal(renderer.root.findByProps({ id: 'church-settings-name' }).props.value, 'Nova Igreja Betel');
  } finally { await unmount(); }
});

test('CA04: saída da tela sem salvar descarta edição do nome e mantém valor anterior', async () => {
  try {
    setup();
    await mount();
    const nameInput = renderer.root.findByProps({ id: 'church-settings-name' });
    await act(async () => nameInput.props.onChange({ target: { value: 'Nome Não Salvo' } }));
    assert.equal(renderer.root.findByProps({ id: 'church-settings-name' }).props.value, 'Nome Não Salvo');

    // Sair sem submeter (desmontar e remontar simulando navegação de volta)
    await unmount();
    await mount();
    assert.equal(renderer.root.findByProps({ id: 'church-settings-name' }).props.value, 'Igreja Teste');
  } finally { await unmount(); }
});

test('CA05: editar apenas o nome preserva endereço, link do maps e logo anteriores', async () => {
  try {
    const { calls } = setup();
    await mount();
    const nameInput = renderer.root.findByProps({ id: 'church-settings-name' });
    await act(async () => nameInput.props.onChange({ target: { value: 'Igreja Central' } }));
    await submit();

    const command = calls.find((c) => c.name === 'update_church_settings').params;
    assert.equal(command.p_name, 'Igreja Central');
    assert.equal(command.p_address, original.address);
    assert.equal(command.p_google_maps_url, original.google_maps_url);
    assert.equal(command.p_logo_path, original.logo_path);
  } finally { await unmount(); }
});

test('CA06: concorrência na edição do nome com revisão desatualizada bloqueia formulário e exige recarga', async () => {
  try {
    setup({ rpc: (name) => name === 'update_church_settings' ? { error: { code: '40001' } } : undefined });
    await mount();
    await act(async () => renderer.root.findByProps({ id: 'church-settings-name' }).props.onChange({ target: { value: 'Igreja Concorrente' } }));
    await submit();

    assert.match(text(), /Outra pessoa atualizou/);
    assert.equal(renderer.root.findByType('fieldset').props.disabled, true);
    await click('Recarregar dados');
    assert.equal(renderer.root.findByType('fieldset').props.disabled, false);
    assert.equal(renderer.root.findByProps({ id: 'church-settings-name' }).props.value, 'Igreja Teste');
  } finally { await unmount(); }
});

// --- Testes de Integração com AuthProvider Real (PR #50 Revisão) ---
const realBundle = path.resolve('node_modules/.cache/church-settings-real-components.mjs');
await build({
  stdin: {
    contents: `
      export { default as RealSettings } from './src/components/ChurchSettingsPage.jsx';
      export { default as RealHome } from './src/components/ChurchHomePage.jsx';
      export { AuthProvider, useAuth } from './src/context/AuthContext.jsx';
    `,
    resolveDir: process.cwd(),
    loader: 'jsx',
  },
  outfile: realBundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['react', 'react-dom', 'lucide-react'],
  plugins: [{
    name: 'real-transport',
    setup(builder) {
      builder.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'transport', namespace: 'real' }));
      builder.onLoad({ filter: /.*/, namespace: 'real' }, () => ({
        contents: `
          export const supabase = {
            schema: (...args) => globalThis.__realTransport.schema(...args),
            rpc: (...args) => globalThis.__realTransport.rpc(...args),
            storage: {
              from: (...args) => globalThis.__realTransport.storage.from(...args),
            },
            auth: {
              onAuthStateChange: (...args) => globalThis.__realTransport.auth.onAuthStateChange(...args),
              getSession: (...args) => globalThis.__realTransport.auth.getSession(...args),
              signOut: (...args) => globalThis.__realTransport.auth.signOut(...args),
            }
          };
          export const isSupabaseConfigured = () => true;
        `,
        loader: 'js',
      }));
    },
  }],
});
const { RealSettings, RealHome, AuthProvider: RealAuthProvider } = await import(pathToFileURL(realBundle).href);

function visibleText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(visibleText).join(' ');
  return visibleText(node.children ?? node.props?.children);
}

function setupRealEnvironment(options = {}) {
  const items = new Map();
  const storage = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, String(v)),
    removeItem: (k) => items.delete(k),
    clear: () => items.clear(),
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
  URL.createObjectURL = () => 'blob:real-logo';
  URL.revokeObjectURL = () => {};

  const rpcCalls = [];
  const state = {
    currentUser: options.user || { id: 'admin-real-id', email: 'admin-real@example.com' },
    currentChurchAccess: options.churchAccess || {
      church_id: churchId,
      church_name: options.initialName || 'Igreja Original 50',
      is_admin: true,
    },
    profile: {
      church_id: churchId,
      name: options.initialName || 'Igreja Original 50',
      timezone: 'America/Sao_Paulo',
      address: 'Rua das Flores, 10',
      google_maps_url: 'https://maps.app.goo.gl/exemplo',
      logo_path: null,
      profile_revision: 0,
    },
    rpcCalls,
  };

  const executeRpc = async (name, params) => {
    rpcCalls.push({ name, params });
    if (options.rpcHandler) {
      const handled = await options.rpcHandler(name, params);
      if (handled !== undefined) return handled;
    }
    if (name === 'get_my_church_access') {
      return { data: state.currentChurchAccess ? [state.currentChurchAccess] : [], error: null };
    }
    if (name === 'get_church_settings') {
      return { data: [{ ...state.profile }], error: null };
    }
    if (name === 'get_church_logo') {
      return { data: [{ logo_path: state.profile.logo_path }], error: null };
    }
    if (name === 'check_church_creation_eligibility') {
      return { data: [{ eligible: false }], error: null };
    }
    if (name === 'update_church_settings') {
      state.profile.name = params.p_name !== undefined ? params.p_name : state.profile.name;
      state.profile.address = params.p_address;
      state.profile.google_maps_url = params.p_google_maps_url;
      state.profile.logo_path = params.p_logo_path;
      state.profile.profile_revision = params.p_expected_revision + 1;
      if (state.currentChurchAccess && state.currentChurchAccess.church_id === churchId) {
        state.currentChurchAccess = {
          ...state.currentChurchAccess,
          church_name: state.profile.name,
        };
      }
      return {
        data: [{
          church_id: churchId,
          command_id: params.p_command_id,
          profile_revision: state.profile.profile_revision,
        }],
        error: null,
      };
    }
    return { data: null, error: null };
  };

  globalThis.__realTransport = {
    rpc: executeRpc,
    schema: () => ({ rpc: executeRpc }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: 'https://example.invalid/signed' }, error: null }),
      }),
    },
    auth: {
      onAuthStateChange: (cb) => {
        if (options.onAuthStateChangeInterceptor) {
          options.onAuthStateChangeInterceptor(cb);
        }
        cb('SIGNED_IN', { user: state.currentUser });
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: async () => ({
        data: { session: state.currentUser ? { user: state.currentUser } : null },
        error: null,
      }),
      signOut: async () => ({ error: null }),
    },
  };

  return state;
}

async function mountReal(Component = RealHome) {
  let r;
  await act(async () => {
    r = TestRenderer.create(React.createElement(RealAuthProvider, null, React.createElement(Component)));
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  return r;
}

test('PR50-R1: Salvamento e sincronização bem-sucedidos, com novo nome ao voltar ao início', async () => {
  const env = setupRealEnvironment({
    initialName: 'Igreja Original 50',
  });
  let realRenderer;
  try {
    realRenderer = await mountReal();
    // Garante que a tela inicial carregou com o nome original
    assert.match(visibleText(realRenderer.toJSON()), /Igreja Original 50/);

    // Navega para as configurações da igreja
    const gotoBtn = realRenderer.root.findByProps({ id: 'btn-goto-church-settings' });
    await act(async () => { await gotoBtn.props.onClick(); });

    // Encontra o input de nome e altera
    const nameInput = realRenderer.root.findByProps({ id: 'church-settings-name' });
    assert.equal(nameInput.props.value, 'Igreja Original 50');
    await act(async () => {
      nameInput.props.onChange({ target: { value: 'Igreja Renovada 50' } });
    });

    // Submete o formulário
    await act(async () => {
      await realRenderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
    });

    // Verifica que exibiu a mensagem de sucesso e não a mensagem de advertência
    assert.match(visibleText(realRenderer.toJSON()), /Alterações salvas com sucesso/);
    assert.doesNotMatch(visibleText(realRenderer.toJSON()), /sincronização da navegação falhou/);

    // Volta ao início
    const backBtn = realRenderer.root.findByProps({ id: 'btn-church-settings-back' });
    await act(async () => { await backBtn.props.onClick(); });

    // Verifica que a tela inicial agora exibe o novo nome confirmado
    assert.match(visibleText(realRenderer.toJSON()), /Igreja Renovada 50/);
    assert.doesNotMatch(visibleText(realRenderer.toJSON()), /Igreja Original 50/);
  } finally {
    if (realRenderer) await act(async () => realRenderer.unmount());
  }
});

test('PR50-R2: Salvamento confirmado e falha na consulta de acesso exibe recuperação sem falso sucesso', async () => {
  let accessCalls = 0;
  const env = setupRealEnvironment({
    initialName: 'Igreja Original 50',
    rpcHandler: async (name) => {
      if (name === 'get_my_church_access') {
        accessCalls++;
        // Chamada inicial no mount funciona; chamada subsequente (sincronização pós-salvamento) falha
        if (accessCalls > 1) {
          return { data: null, error: { message: 'Network error ao sincronizar vínculo' } };
        }
      }
    },
  });
  let realRenderer;
  try {
    realRenderer = await mountReal();

    // Navega para configurações
    await act(async () => {
      await realRenderer.root.findByProps({ id: 'btn-goto-church-settings' }).props.onClick();
    });

    // Altera o nome e salva
    const nameInput = realRenderer.root.findByProps({ id: 'church-settings-name' });
    await act(async () => {
      nameInput.props.onChange({ target: { value: 'Igreja Salva Sem Sync' } });
    });
    await act(async () => {
      await realRenderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
    });

    // O salvamento foi confirmado no backend
    assert.equal(env.profile.name, 'Igreja Salva Sem Sync');

    // Mas a sincronização da navegação falhou: não há falso sucesso
    const textContent = visibleText(realRenderer.toJSON());
    assert.match(textContent, /sincronização da navegação falhou/);
    assert.doesNotMatch(textContent, /Alterações salvas com sucesso\./);

    // O botão de sincronizar navegação está presente para recuperação
    const syncBtn = realRenderer.root.findByProps({ id: 'btn-church-settings-sync' });
    assert.ok(syncBtn, 'Botão de sincronizar navegação deve existir');
  } finally {
    if (realRenderer) await act(async () => realRenderer.unmount());
  }
});

test('PR50-R3: Recuperação posterior sincroniza navegação sem novo comando de escrita', async () => {
  let accessCalls = 0;
  let syncShouldFail = true;
  const env = setupRealEnvironment({
    initialName: 'Igreja Original 50',
    rpcHandler: async (name) => {
      if (name === 'get_my_church_access') {
        accessCalls++;
        if (accessCalls > 1 && syncShouldFail) {
          return { data: null, error: { message: 'Network error na sincronização' } };
        }
      }
    },
  });
  let realRenderer;
  try {
    realRenderer = await mountReal();

    await act(async () => {
      await realRenderer.root.findByProps({ id: 'btn-goto-church-settings' }).props.onClick();
    });

    await act(async () => {
      realRenderer.root.findByProps({ id: 'church-settings-name' }).props.onChange({ target: { value: 'Igreja Recuperada' } });
    });
    await act(async () => {
      await realRenderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
    });

    // Falhou a sincronização inicial
    assert.match(visibleText(realRenderer.toJSON()), /sincronização da navegação falhou/);

    const writeCallsBefore = env.rpcCalls.filter((c) => c.name === 'update_church_settings').length;
    assert.equal(writeCallsBefore, 1);

    // Agora a rede normaliza
    syncShouldFail = false;

    // Clica no botão "Sincronizar navegação"
    const syncBtn = realRenderer.root.findByProps({ id: 'btn-church-settings-sync' });
    await act(async () => {
      await syncBtn.props.onClick();
    });

    // Agora sincronizou com sucesso!
    const textContent = visibleText(realRenderer.toJSON());
    assert.match(textContent, /Alterações salvas com sucesso/);
    assert.doesNotMatch(textContent, /sincronização da navegação falhou/);

    // Garantia crítica: NENHUM novo comando de escrita foi emitido
    const writeCallsAfter = env.rpcCalls.filter((c) => c.name === 'update_church_settings').length;
    assert.equal(writeCallsAfter, 1, 'Não deve emitir novo comando de escrita durante recuperação de sincronização');

    // Voltando ao início, reflete o novo nome
    await act(async () => {
      await realRenderer.root.findByProps({ id: 'btn-church-settings-back' }).props.onClick();
    });
    assert.match(visibleText(realRenderer.toJSON()), /Igreja Recuperada/);
  } finally {
    if (realRenderer) await act(async () => realRenderer.unmount());
  }
});

test('PR50-R4: Falha inicial de recarga do perfil seguida de recuperação atualiza navegação', async () => {
  let profileReadCalls = 0;
  let failProfileReload = false;
  const env = setupRealEnvironment({
    initialName: 'Igreja Original 50',
    rpcHandler: async (name) => {
      if (name === 'get_church_settings') {
        profileReadCalls++;
        // Leitura inicial passa; primeira recarga pós-salvamento falha
        if (failProfileReload) {
          return { data: null, error: { message: 'Erro temporário de leitura de perfil' } };
        }
      }
    },
  });
  let realRenderer;
  try {
    realRenderer = await mountReal();

    await act(async () => {
      await realRenderer.root.findByProps({ id: 'btn-goto-church-settings' }).props.onClick();
    });

    await act(async () => {
      realRenderer.root.findByProps({ id: 'church-settings-name' }).props.onChange({ target: { value: 'Igreja Pós-Recarga Perfil' } });
    });

    // Ativa falha na leitura do perfil
    failProfileReload = true;
    await act(async () => {
      await realRenderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
    });

    // O recibo foi confirmado no backend
    assert.equal(env.profile.name, 'Igreja Pós-Recarga Perfil');

    // Tela exibe erro de carregamento com opção de tentar novamente
    const textAfterFail = visibleText(realRenderer.toJSON());
    assert.match(textAfterFail, /A edição fica bloqueada até que os dados atuais sejam confirmados/);

    // Rede restabelecida para a leitura
    failProfileReload = false;
    const writeCallsCount = env.rpcCalls.filter((c) => c.name === 'update_church_settings').length;

    // Clica em "Tentar novamente" na mensagem de erro do perfil
    const retryBtn = realRenderer.root.findAllByType('button').find((b) => visibleText(b.props.children).includes('Tentar novamente'));
    assert.ok(retryBtn, 'Botão tentar novamente deve estar visível');
    await act(async () => {
      await retryBtn.props.onClick();
    });

    // Após recuperação, contexto foi sincronizado e exibe sucesso
    const textAfterRecovery = visibleText(realRenderer.toJSON());
    assert.match(textAfterRecovery, /Alterações salvas com sucesso/);

    // Nenhum novo comando de escrita foi emitido
    assert.equal(env.rpcCalls.filter((c) => c.name === 'update_church_settings').length, writeCallsCount);

    // Volta ao início e verifica o nome atualizado na navegação
    await act(async () => {
      await realRenderer.root.findByProps({ id: 'btn-church-settings-back' }).props.onClick();
    });
    assert.match(visibleText(realRenderer.toJSON()), /Igreja Pós-Recarga Perfil/);
  } finally {
    if (realRenderer) await act(async () => realRenderer.unmount());
  }
});

test('PR50-R5: Troca de sessão ou igreja durante a sincronização não contamina o contexto seguinte', async () => {
  let authCallback;
  const syncDeferred = deferred();
  let syncStartedDeferred = deferred();
  let updateChurchSettingsDone = false;
  const env = setupRealEnvironment({
    initialName: 'Igreja Original 50',
    onAuthStateChangeInterceptor: (cb) => {
      authCallback = cb;
    },
    rpcHandler: async (name) => {
      if (name === 'update_church_settings') {
        updateChurchSettingsDone = true;
      }
      if (name === 'get_my_church_access' && updateChurchSettingsDone) {
        updateChurchSettingsDone = false;
        // Sinaliza que a sincronização pós-salvamento iniciou e está pausada em voo
        syncStartedDeferred.resolve();
        await syncDeferred.promise;
        return { data: [{ church_id: churchId, church_name: 'Nome Antigo Descartado', is_admin: true }], error: null };
      }
    },
  });
  let realRenderer;
  try {
    realRenderer = await mountReal();

    await act(async () => {
      await realRenderer.root.findByProps({ id: 'btn-goto-church-settings' }).props.onClick();
    });

    await act(async () => {
      realRenderer.root.findByProps({ id: 'church-settings-name' }).props.onChange({ target: { value: 'Nome Em Voo' } });
    });

    // Inicia salvamento
    let savePromise;
    act(() => {
      savePromise = realRenderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
    });

    // Aguarda a sincronização pós-salvamento entrar em voo
    await syncStartedDeferred.promise;

    // Durante a sincronização em voo, ocorre troca de usuário/sessão
    const newUser = { id: 'outro-user-id', email: 'outro@example.com' };
    const otherChurchAccess = {
      church_id: '01700000-0000-4000-8000-000000000099',
      church_name: 'Igreja de Outro Usuário',
      is_admin: true,
    };
    env.currentUser = newUser;
    env.currentChurchAccess = otherChurchAccess;

    await act(async () => {
      // Dispara troca de sessão no AuthContext e aguarda processamento do novo usuário
      authCallback('SIGNED_IN', { user: newUser });
      await new Promise((r) => setTimeout(r, 40));
    });

    // Agora resolve a resposta da consulta anterior que estava em voo
    await act(async () => {
      syncDeferred.resolve();
      await savePromise;
      await new Promise((r) => setTimeout(r, 20));
    });

    // Verifica que o contexto do novo usuário NÃO foi contaminado com o nome em voo ou descartado
    const currentText = visibleText(realRenderer.toJSON());
    assert.doesNotMatch(currentText, /Nome Em Voo/);
    assert.doesNotMatch(currentText, /Nome Antigo Descartado/);
    assert.match(currentText, /Igreja de Outro Usuário/);
  } finally {
    if (realRenderer) await act(async () => realRenderer.unmount());
  }
});
