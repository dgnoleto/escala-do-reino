import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Prepara diretório de cache em node_modules
const cacheDir = path.resolve(process.cwd(), 'node_modules', '.cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}
const bundlePath = path.join(cacheDir, 'codex-regressions.bundle.mjs');

// Transpila os componentes reais de produção sem alterar sua lógica, substituindo apenas o transporte Supabase
await build({
  stdin: {
    contents: `
      export { default as App } from './src/App.jsx';
      export { AuthProvider, useAuth } from './src/context/AuthContext.jsx';
      export { default as InvitationFlowPage } from './src/components/InvitationFlowPage.jsx';
      export { default as IssueInvitationModal } from './src/components/IssueInvitationModal.jsx';
      export { default as AdminInvitationsTab } from './src/components/AdminInvitationsTab.jsx';
      export { default as AdminRequestsTab } from './src/components/AdminRequestsTab.jsx';
      export { default as MembersPage } from './src/components/MembersPage.jsx';
      export { default as LoginPage } from './src/components/LoginPage.jsx';
      export { default as AccessPendingPage } from './src/components/AccessPendingPage.jsx';
      export { default as SelectChurchPage } from './src/components/SelectChurchPage.jsx';
      export { default as ChurchHomePage } from './src/components/ChurchHomePage.jsx';
      export {
        saveAccessRequestMarker,
        loadAccessRequestMarker,
        removeAccessRequestMarker,
      } from './src/utils/invitationCommandService.js';
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
    name: 'review-transport',
    setup(builder) {
      builder.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'transport', namespace: 'review' }));
      builder.onLoad({ filter: /.*/, namespace: 'review' }, () => ({
        contents: `
          export const supabase = {
            schema: (...args) => globalThis.__reviewTransport.schema(...args),
            auth: {
              onAuthStateChange: (...args) => globalThis.__reviewTransport.auth.onAuthStateChange(...args),
              getSession: (...args) => globalThis.__reviewTransport.auth.getSession(...args),
              signOut: (...args) => globalThis.__reviewTransport.auth.signOut(...args),
              signInWithOAuth: (...args) => globalThis.__reviewTransport.auth.signInWithOAuth(...args),
              signInWithPassword: (...args) => globalThis.__reviewTransport.auth.signInWithPassword(...args),
              signUp: (...args) => globalThis.__reviewTransport.auth.signUp(...args),
              resetPasswordForEmail: (...args) => globalThis.__reviewTransport.auth.resetPasswordForEmail(...args),
              updateUser: (...args) => globalThis.__reviewTransport.auth.updateUser(...args),
            }
          };
          export const isSupabaseConfigured = () => true;
        `,
        loader: 'js',
      }));
    },
  }],
});

const {
  App,
  AuthProvider,
  useAuth,
  InvitationFlowPage,
  IssueInvitationModal,
  AdminInvitationsTab,
  AdminRequestsTab,
  MembersPage,
  LoginPage,
  AccessPendingPage,
  SelectChurchPage,
  ChurchHomePage,
  saveAccessRequestMarker,
  loadAccessRequestMarker,
  removeAccessRequestMarker,
} = await import(pathToFileURL(bundlePath).href);

function setupEnvironment(options = {}) {
  const items = new Map();
  const storage = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, String(v)),
    removeItem: (k) => items.delete(k),
    clear: () => items.clear(),
    key: (i) => [...items.keys()][i] ?? null,
    get length() { return items.size; },
  };

  let currentUrl = options.initialUrl || 'http://localhost:3000/';
  const historyCalls = [];

  const locationObj = {
    get href() { return currentUrl; },
    set href(v) { currentUrl = v; },
    get origin() { return 'http://localhost:3000'; },
    get hash() {
      const idx = currentUrl.indexOf('#');
      return idx >= 0 ? currentUrl.slice(idx) : '';
    },
    set hash(h) {
      const base = currentUrl.split('#')[0];
      currentUrl = base + (h ? (h.startsWith('#') ? h : '#' + h) : '');
    },
    pathname: '/',
    search: '',
  };

  const clipboardCalls = [];
  let clipboardShouldFail = Boolean(options.clipboardShouldFail);

  globalThis.window = {
    sessionStorage: storage,
    location: locationObj,
    history: {
      replaceState: (state, title, url) => {
        historyCalls.push({ state, title, url });
        if (url) {
          if (url.startsWith('/')) {
            currentUrl = locationObj.origin + url;
          } else {
            currentUrl = url;
          }
        }
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };

  globalThis.document = {
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      onLine: true,
      clipboard: {
        writeText: async (text) => {
          if (clipboardShouldFail) {
            throw new Error('Clipboard permission denied');
          }
          clipboardCalls.push(text);
          return Promise.resolve();
        },
      },
    },
  });

  const rpcCalls = [];
  const authCalls = [];
  let authListener = null;

  const user = options.user !== undefined ? options.user : {
    id: 'user-default-uid',
    email: 'membro@exemplo.com',
    user_metadata: { full_name: 'Membro Teste' },
  };

  const session = user ? { user } : null;

  const defaultRpcHandler = options.rpcHandler || (async (name, args) => {
    return { data: [], error: null };
  });

  globalThis.__reviewTransport = {
    auth: {
      onAuthStateChange: (cb) => {
        authListener = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session } }),
      signOut: async () => {
        authCalls.push({ type: 'signOut' });
        if (authListener) authListener('SIGNED_OUT', null);
        return { error: null };
      },
      signInWithOAuth: async (opts) => {
        authCalls.push({ type: 'signInWithOAuth', opts });
        return { error: null };
      },
      signInWithPassword: async (creds) => {
        authCalls.push({ type: 'signInWithPassword', email: creds.email });
        return { data: { session: { user } }, error: null };
      },
      signUp: async (creds) => {
        authCalls.push({ type: 'signUp', email: creds.email, options: creds.options });
        if (options.signUpRequiresEmailConfirm) {
          return { data: { user: { id: 'new-uid', email: creds.email }, session: null }, error: null };
        }
        return { data: { user: { id: 'new-uid', email: creds.email }, session: { user } }, error: null };
      },
      resetPasswordForEmail: async (email, opts) => {
        authCalls.push({ type: 'resetPasswordForEmail', email, opts });
        return { data: {}, error: null };
      },
      updateUser: async (attrs) => {
        authCalls.push({ type: 'updateUser', attrs });
        return { data: { user }, error: null };
      },
      simulateEvent: (event, sess) => {
        if (authListener) authListener(event, sess);
      },
    },
    schema: () => ({
      rpc(name, args) {
        rpcCalls.push({ name, args });
        return defaultRpcHandler(name, args);
      },
    }),
  };

  return {
    storage,
    location: locationObj,
    historyCalls,
    clipboardCalls,
    rpcCalls,
    authCalls,
    setClipboardShouldFail: (val) => { clipboardShouldFail = val; },
    getAuthListener: () => authListener,
    simulateEvent: (ev, s) => globalThis.__reviewTransport.auth.simulateEvent(ev, s),
  };
}

function visibleText(renderer) {
  function visit(node) {
    if (node == null) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(visit).join(' ');
    if (node.type === 'style') return '';
    return visit(node.children);
  }
  return visit(renderer.toJSON());
}

async function mount(element) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
    await new Promise((r) => setTimeout(r, 20));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
  return renderer;
}


const uid = '00000000-0000-4000-8000-000000000001';
const churchA = '00000000-0000-4000-8000-000000000002';
const churchB = '00000000-0000-4000-8000-000000000003';
const memberId = '00000000-0000-4000-8000-000000000004';
const reqId = '00000000-0000-4000-8000-000000000005';
const invId = '00000000-0000-4000-8000-000000000006';
const token43 = 'Ab'.repeat(21) + 'C';
const user = { id: uid, email: 'pessoa@example.invalid' };
const activeMember = { id: memberId, member_id: memberId, display_name: 'Pessoa', status: 'active', total_count: 1 };
const accessA = { church_id: churchA, church_name: 'Igreja A', member_id: memberId, display_name: 'Pessoa', is_admin: true };
const details = { invitation_id: invId, church_id: churchB, church_name: 'Igreja B', member_id: memberId, member_display_name: 'Pessoa', is_valid: true, expires_at: '2026-10-12T23:00:00Z' };
const emitted = (args) => ({ invitation_id: invId, church_id: args.p_church_id, member_id: args.p_member_id, recipient_email: args.p_recipient_email, raw_token: token43, issued_at: '2026-10-09T23:00:00Z', expires_at: '2026-10-12T23:00:00Z', previous_invitation_revoked: true, previous_request_cancelled: false });
const confirmPayload = { church_id: churchB, church_name: 'Igreja B', member_id: memberId, display_name: 'Pessoa', access_granted: true, onboarding_completed_at: '2026-10-09T23:01:00Z' };
const timeout = { data: null, error: { code: 'PGRST000', message: 'Network timeout' } };
const empty = () => ({ data: [], error: null });
const deferredReview = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
const pause = () => new Promise(r => setTimeout(r, 30));
async function fillIssue(renderer, email = 'pessoa@example.invalid') {
  await act(async () => renderer.root.findByProps({id:'invite-recipient-email'}).props.onChange({target:{value:email}}));
}
async function submitForm(renderer) {
  await act(async () => { renderer.root.findByType('form').props.onSubmit({preventDefault(){}}); await pause(); });
}

test('R1: emissao integrada em MembersPage deve manter o link visivel para copiar', async (t) => {
  setupEnvironment({user, rpcHandler: async(name,args) => {
    if(name==='get_my_church_access') return {data:[accessA],error:null};
    if(name==='list_church_members_admin' || name==='list_church_members') return {data:[activeMember],error:null};
    if(name==='issue_church_invitation') return {data:[emitted(args)],error:null};
    return empty();
  }});
  const renderer = await mount(React.createElement(AuthProvider,null,React.createElement(MembersPage)));
  t.after(()=>act(()=>renderer.unmount()));
  await act(async()=>renderer.root.findByProps({id:'btn-invite-member-'+memberId}).props.onClick());
  await fillIssue(renderer);
  await act(async()=>renderer.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));
  await submitForm(renderer);
  assert.equal(renderer.root.findAllByProps({id:'generated-invite-link'}).length,1,'O pai desmontou o modal antes de o administrador copiar o link');
});

test('R2: reemissao pela aba deve exigir a confirmacao apresentada ao administrador', async(t)=>{
  const env = setupEnvironment({user,rpcHandler:async(name,args)=>{
    if(name==='list_church_invitations') return {data:[{invitation_id:invId,member_id:memberId,member_display_name:'Pessoa',recipient_email:'pessoa@example.invalid',status:'open',issued_at:'2026-10-09T23:00:00Z',expires_at:'2026-10-12T23:00:00Z',total_count:1}],error:null};
    if(name==='issue_church_invitation') return {data:[emitted(args)],error:null};
    return empty();
  }});
  const renderer=await mount(React.createElement(AuthProvider,null,React.createElement(AdminInvitationsTab,{churchId:churchA,churchName:'Igreja A'})));
  t.after(()=>act(()=>renderer.unmount()));
  await act(async()=>renderer.root.findByProps({title:'Reemitir convite'}).props.onClick());
  await fillIssue(renderer);
  assert.equal(renderer.root.findByProps({type:'checkbox'}).props.checked,false);
  await submitForm(renderer);
  assert.equal(env.rpcCalls.filter(c=>c.name==='issue_church_invitation').length,0,'Reemissao ocorreu sem confirmar a invalidacao do convite anterior');
});

test('R3: recibo de outro command_id nao pode confirmar acesso',async(t)=>{
  setupEnvironment({user,rpcHandler:async(name,args)=>{
    if(name==='get_invitation_details') return {data:[details],error:null};
    if(name==='redeem_invitation_confirm_name') return timeout;
    if(name==='get_invitation_command_receipt') return {data:[{command_id:'00000000-0000-4000-8000-ffffffffffff',action:'redeem_confirm_name',church_id:churchB,result_member_id:memberId,result_entity_id:'00000000-0000-4000-8000-000000000099',result_payload:confirmPayload,created_at:'2026-10-09T23:01:00Z',link_unrecoverable:false}],error:null};
    return empty();
  }});
  const renderer=await mount(React.createElement(AuthProvider,null,React.createElement(InvitationFlowPage,{token:token43,onClearToken(){}})));
  t.after(()=>act(()=>renderer.unmount()));
  await act(async()=>{renderer.root.findByProps({id:'btn-confirm-name'}).props.onClick();await pause();});
  assert.doesNotMatch(visibleText(renderer),/Acesso Confirmado!/,'Recibo de outro comando foi aceito como sucesso');
});

test('R4: parametros de emissao incerta ficam congelados no mesmo comando',async(t)=>{
  const env=setupEnvironment({user,rpcHandler:async(name)=>name==='issue_church_invitation'?timeout:empty()});
  const renderer=await mount(React.createElement(AuthProvider,null,React.createElement(IssueInvitationModal,{member:activeMember,churchId:churchA,churchName:'Igreja A',isOpen:true,onClose(){}})));
  t.after(()=>act(()=>renderer.unmount()));
  await fillIssue(renderer,'primeiro@example.invalid');
  await submitForm(renderer);
  const first=env.rpcCalls.find(c=>c.name==='issue_church_invitation').args;
  const input=renderer.root.findByProps({id:'invite-recipient-email'});
  if(!input.props.disabled) await fillIssue(renderer,'segundo@example.invalid');
  await submitForm(renderer);
  const writes=env.rpcCalls.filter(c=>c.name==='issue_church_invitation');
  assert.equal(writes[1].args.p_command_id,first.p_command_id);
  assert.equal(writes[1].args.p_recipient_email,first.p_recipient_email,'Mesmo command_id foi reutilizado com outro e-mail');
});

test('R5: proposta de admin A para igreja B deve continuar acessivel no aplicativo real',async(t)=>{
  const env=setupEnvironment({user,initialUrl:'http://localhost:3000/#/invite?token='+token43,rpcHandler:async(name)=>{
    if(name==='get_my_church_access') return {data:[accessA],error:null};
    if(name==='get_invitation_details') return {data:[details],error:null};
    if(name==='redeem_invitation_propose_name'||name==='get_my_access_request') return {data:[{request_id:reqId,church_id:churchB,church_name:'Igreja B',member_id:memberId,original_display_name:'Pessoa',proposed_display_name:'Pessoa Nova',status:'pending',submitted_at:'2026-10-09T23:01:00Z',expires_at:'2026-10-12T23:00:00Z',is_expired:false}],error:null};
    return empty();
  }});
  const renderer=await mount(React.createElement(App));
  t.after(()=>act(()=>renderer.unmount()));
  await act(async()=>renderer.root.findByProps({id:'btn-propose-other-name'}).props.onClick());
  await act(async()=>renderer.root.findByProps({id:'input-proposed-name'}).props.onChange({target:{value:'Pessoa Nova'}}));
  await submitForm(renderer);
  assert.ok(loadAccessRequestMarker(env.storage,uid),'Marcador deve existir');
  assert.match(visibleText(renderer),/Solicitação|Proposta|proposta|solicitação/,'App voltou para igreja A sem acesso ao acompanhamento da proposta em B');
});

test('R6: resposta de lista da igreja anterior nao pode sobrescrever a igreja atual',async(t)=>{
  const a=deferredReview(), b=deferredReview();
  setupEnvironment({user,rpcHandler:(name,args)=>{
    if(name==='list_church_invitations') return args.p_church_id===churchA?a.promise:b.promise;
    return Promise.resolve(empty());
  }});
  const renderer=await mount(React.createElement(AuthProvider,null,React.createElement(AdminInvitationsTab,{churchId:churchA,churchName:'Igreja A'})));
  t.after(()=>act(()=>renderer.unmount()));
  await act(async()=>renderer.update(React.createElement(AuthProvider,null,React.createElement(AdminInvitationsTab,{churchId:churchB,churchName:'Igreja B'}))));
  const row=(name)=>({invitation_id:invId,member_id:memberId,member_display_name:name,recipient_email:'pessoa@example.invalid',status:'open',total_count:1});
  await act(async()=>{b.resolve({data:[row('Membro Atual B')],error:null});await pause();});
  assert.match(visibleText(renderer),/Membro Atual B/);
  await act(async()=>{a.resolve({data:[row('Membro Antigo A')],error:null});await pause();});
  assert.doesNotMatch(visibleText(renderer),/Membro Antigo A/,'Consulta obsoleta restaurou dados da igreja anterior');
});

test('R7: recarga apos resgate incerto deve consultar o recibo do comando salvo',async(t)=>{
  let consumed=false;
  const env=setupEnvironment({user,rpcHandler:async(name)=>{
    if(name==='get_invitation_details') return {data:[consumed?{is_valid:false}:details],error:null};
    if(name==='redeem_invitation_confirm_name'){consumed=true;return timeout;}
    return empty();
  }});
  const element=()=>React.createElement(AuthProvider,null,React.createElement(InvitationFlowPage,{token:token43,onClearToken(){}}));
  let renderer=await mount(element());
  await act(async()=>{renderer.root.findByProps({id:'btn-confirm-name'}).props.onClick();await pause();});
  const savedKeys=Array.from({length:env.storage.length},(_,i)=>env.storage.key(i)).filter(k=>k.startsWith('escala_invitation_cmd_'));
  assert.equal(savedKeys.length,1);
  const savedCommand=JSON.parse(env.storage.getItem(savedKeys[0]));
  act(()=>renderer.unmount());
  env.rpcCalls.length=0;
  renderer=await mount(element());
  t.after(()=>act(()=>renderer.unmount()));
  assert.ok(env.rpcCalls.some(c=>c.name==='get_invitation_command_receipt'&&c.args.p_command_id===savedCommand.commandId),'Comando salvo foi ignorado e o convite consumido passou a ser mostrado como invalido');
});
