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
const bundlePath = path.join(cacheDir, 'review-complemento.bundle.mjs');

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


const uid='00000000-0000-4000-8000-000000000001';
const churchId='00000000-0000-4000-8000-000000000002';
const memberId='00000000-0000-4000-8000-000000000003';
const requestId='00000000-0000-4000-8000-000000000004';
const invitationId='00000000-0000-4000-8000-000000000005';
const user={id:uid,email:'pessoa@example.invalid'};
const token43='Ab'.repeat(21)+'C';
const empty=()=>({data:[],error:null});
const timeout={data:null,error:{code:'PGRST000',message:'Network timeout'}};
const pause=()=>new Promise(r=>setTimeout(r,30));
const pending={request_id:requestId,member_id:memberId,current_display_name:'Pessoa',original_display_name:'Pessoa',proposed_display_name:'Pessoa Nova',requester_email:user.email,status:'pending',expires_at:'2026-10-13T23:00:00Z',submitted_at:'2026-10-10T23:00:00Z',total_count:1};
const details={invitation_id:invitationId,church_id:churchId,church_name:'Igreja B',member_id:memberId,member_display_name:'Pessoa',is_valid:true,expires_at:'2026-10-13T23:00:00Z'};
async function clickDecision(renderer,decision='approve'){
 await act(async()=>renderer.root.findByProps({id:(decision==='approve'?'btn-approve-':'btn-reject-')+requestId}).props.onClick());
 await act(async()=>{renderer.root.findByProps({id:'btn-confirm-decision-execute'}).props.onClick();await pause();});
}
for(const [intent,result] of [['approve','approved'],['reject','rejected']]){
 test('C1-'+intent+': recuperar decisao confirmada por recibo real '+result,async(t)=>{
  let commandId;
  setupEnvironment({user,rpcHandler:async(name,args)=>{
   if(name==='list_church_access_requests')return {data:[pending],error:null};
   if(name==='decide_access_request'){commandId=args.p_command_id;return timeout;}
   if(name==='get_invitation_command_receipt')return {data:[{command_id:commandId,action:'decide_access_request',church_id:churchId,result_member_id:memberId,result_entity_id:requestId,result_payload:{request_id:requestId,member_id:memberId,final_display_name:result==='approved'?'Pessoa Nova':'Pessoa',decision:result,access_granted:result==='approved',decided_at:'2026-10-10T23:01:00Z',error_code:null},created_at:'2026-10-10T23:01:00Z',link_unrecoverable:false}],error:null};
   return empty();
  }});
  const renderer=await mount(React.createElement(AuthProvider,null,React.createElement(AdminRequestsTab,{churchId})));
  t.after(()=>act(()=>renderer.unmount()));
  await clickDecision(renderer,intent);
  assert.match(visibleText(renderer),result==='approved'?/aprovado com sucesso/:/solicitação foi rejeitada/,'Recibo valido foi recusado apesar de decisao confirmada');
 });
}
test('C2: confirmacao incerta nao pode mudar para proposta com novo comando',async(t)=>{
 const env=setupEnvironment({user,rpcHandler:async(name)=>name==='get_invitation_details'?{data:[details],error:null}:name==='redeem_invitation_confirm_name'||name==='redeem_invitation_propose_name'?timeout:empty()});
 const renderer=await mount(React.createElement(AuthProvider,null,React.createElement(InvitationFlowPage,{token:token43,onClearToken(){}})));
 t.after(()=>act(()=>renderer.unmount()));
 await act(async()=>{renderer.root.findByProps({id:'btn-confirm-name'}).props.onClick();await pause();});
 const switchButton=renderer.root.findAllByProps({id:'btn-propose-other-name'})[0];
 if(switchButton&&!switchButton.props.disabled){
  await act(async()=>switchButton.props.onClick());
  await act(async()=>renderer.root.findByProps({id:'input-proposed-name'}).props.onChange({target:{value:'Pessoa Nova'}}));
  await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}});await pause();});
 }
 assert.equal(env.rpcCalls.filter(c=>c.name==='redeem_invitation_propose_name').length,0,'Operacao incerta foi trocada por outra intencao e outro command_id');
});
test('C3: decisao pendente deve consultar recibo ao remontar a aba',async(t)=>{
 const env=setupEnvironment({user,rpcHandler:async(name)=>name==='list_church_access_requests'?{data:[pending],error:null}:name==='decide_access_request'?timeout:empty()});
 const element=()=>React.createElement(AuthProvider,null,React.createElement(AdminRequestsTab,{churchId}));
 let renderer=await mount(element());
 await clickDecision(renderer);
 const key='escala_invitation_cmd_'+uid+'_decide_access_request';
 const saved=JSON.parse(env.storage.getItem(key));
 assert.ok(saved?.commandId);
 act(()=>renderer.unmount());env.rpcCalls.length=0;
 renderer=await mount(element());t.after(()=>act(()=>renderer.unmount()));
 assert.ok(env.rpcCalls.some(c=>c.name==='get_invitation_command_receipt'&&c.args.p_command_id===saved.commandId),'Aba nao restaura nem consulta decisao salva');
});
test('C4: cancelar modal incerto nao pode apagar o comando de emissao',async(t)=>{
 const env=setupEnvironment({user,rpcHandler:async(name)=>name==='issue_church_invitation'?timeout:empty()});
 const renderer=await mount(React.createElement(AuthProvider,null,React.createElement(IssueInvitationModal,{churchId,churchName:'Igreja B',member:{member_id:memberId,display_name:'Pessoa',status:'active'},isOpen:true,onClose(){}})));
 t.after(()=>act(()=>renderer.unmount()));
 await act(async()=>renderer.root.findByProps({id:'invite-recipient-email'}).props.onChange({target:{value:user.email}}));
 await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}});await pause();});
 const key='escala_invitation_cmd_'+uid+'_issue_invitation';
 assert.ok(env.storage.getItem(key));
 const closeButton=renderer.root.findByProps({'aria-label':'Fechar modal de convite'});
 if(!closeButton.props.disabled)await act(async()=>closeButton.props.onClick());
 assert.ok(env.storage.getItem(key),'Fechar modal apagou operacao ainda desconhecida');
});
test('C5: proposta cancelada em outra igreja deve encerrar acompanhamento com aviso',async(t)=>{
 const env=setupEnvironment({user,rpcHandler:async(name)=>{
  if(name==='get_my_church_access')return {data:[{church_id:'00000000-0000-4000-8000-000000000009',church_name:'Igreja A',member_id:memberId,display_name:'Pessoa',is_admin:true}],error:null};
  if(name==='get_my_access_request')return {data:[{...pending,church_id:churchId,church_name:'Igreja B',status:'cancelled',is_expired:false}],error:null};
  return empty();
 }});
 saveAccessRequestMarker(env.storage,uid,{churchId,requestId});
 const renderer=await mount(React.createElement(AuthProvider,null,React.createElement(ChurchHomePage)));
 t.after(()=>act(()=>renderer.unmount()));
 assert.match(visibleText(renderer),/Cancelad|cancelad/,'Estado cancelled aparece como pendente de aprovacao');
 assert.match(visibleText(renderer),/novo convite/i);
});
