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
      Object.assign(profile, { address: params.p_address, google_maps_url: params.p_google_maps_url, logo_path: params.p_logo_path, profile_revision: params.p_expected_revision + 1 });
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
  return text(node.children);
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
