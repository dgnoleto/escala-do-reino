import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const CHURCH_ID = '00000000-0000-4000-8000-000000000001';
const EVENT_ID = '00000000-0000-4000-8000-000000000099';
const OLD_LEADER_ID = 'm-leader-old';
const NEW_LEADER_ID = 'm-leader-new';

const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, `issue-89-admin-designation-${Date.now()}.bundle.mjs`);

await build({
  stdin: {
    contents: `
      export { AppProvider, useApp } from './src/context/AppContext.jsx';
      export { default as AdminView } from './src/components/AdminView.jsx';
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

const { AppProvider, useApp, AdminView } = await import(pathToFileURL(bundlePath).href);

function createMockSupabase(rpcHandler) {
  return {
    rpc: async (fn, params) => {
      if (rpcHandler) {
        return rpcHandler(fn, params);
      }
      return { data: [], error: null };
    },
  };
}

function canonicalLiturgyReceipt(params, eventId = EVENT_ID, version = 2) {
  return {
    data: [{
      command_id: params.p_command_id,
      action: 'assign_event_liturgy_leader',
      church_id: params.p_church_id,
      result_entity_id: eventId,
      result_payload: {
        id: eventId,
        event_id: eventId,
        previous_liturgy_leader_member_id: OLD_LEADER_ID,
        new_liturgy_leader_member_id: params.p_new_liturgy_leader_member_id,
        version,
      },
      created_at: '2026-11-22T14:00:00Z',
    }],
    error: null,
  };
}

const sampleEvent = {
  id: EVENT_ID,
  church_id: CHURCH_ID,
  title: 'Culto de Celebração',
  event_type: 'culto',
  timezone: 'America/Sao_Paulo',
  status: 'scheduled',
  liturgy_leader_member_id: OLD_LEADER_ID,
  liturgy_leader_name: 'Líder Antigo',
  version: 1,
  planned_start_at: '2026-11-22T19:00:00-03:00',
  planned_end_at: '2026-11-22T21:00:00-03:00',
};

describe('Issue #89 — Designação da Liturgia com Gravação no Servidor (RPC assign_event_liturgy_leader)', () => {

  test('(i) Sucesso só após a RPC: chama assign_event_liturgy_leader, executa reloadRemoteData e atualiza líder', async () => {
    let rpcCalls = [];
    let currentLeader = OLD_LEADER_ID;
    let currentVersion = 1;

    const mockClient = createMockSupabase(async (fn, params) => {
      rpcCalls.push({ fn, params });
      if (fn === 'list_church_events') {
        return {
          data: [{
            events: [{
              ...sampleEvent,
              liturgy_leader_member_id: currentLeader,
              liturgy_leader_name: currentLeader === NEW_LEADER_ID ? 'Novo Líder' : 'Líder Antigo',
              version: currentVersion,
            }],
            total_count: 1,
          }],
          error: null,
        };
      }
      if (fn === 'assign_event_liturgy_leader') {
        currentLeader = params.p_new_liturgy_leader_member_id;
        currentVersion = (params.p_expected_version || 1) + 1;
        return canonicalLiturgyReceipt(params, params.p_event_id, currentVersion);
      }
      return { data: [], error: null };
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        React.createElement(AppProvider, {
          initialUserId: 'marcos',
          churchId: CHURCH_ID,
          supabaseClient: mockClient,
          allowMemoryFallback: false,
        }, React.createElement(Consumer))
      );
    });

    assert.equal(appCtx.events.length, 1);
    assert.equal(appCtx.events[0].liturgyLeaderId, OLD_LEADER_ID);

    let result;
    await act(async () => {
      result = await appCtx.designateLiturgyLeader(NEW_LEADER_ID, EVENT_ID);
    });

    assert.equal(result?.success, true, 'Deve retornar success: true após RPC com recibo');
    const assignCall = rpcCalls.find(c => c.fn === 'assign_event_liturgy_leader');
    assert.ok(assignCall, 'Deve ter chamado assign_event_liturgy_leader');
    assert.equal(assignCall.params.p_new_liturgy_leader_member_id, NEW_LEADER_ID);

    // O reloadRemoteData foi chamado e atualizou o evento no AppContext
    assert.equal(appCtx.events[0].liturgyLeaderId, NEW_LEADER_ID);
    assert.equal(appCtx.events[0].version, 2);
  });

  test('(ii) Falha da RPC sem falso sucesso e sem alterar o líder local (ex: erro 42501)', async () => {
    const mockClient = createMockSupabase(async (fn, params) => {
      if (fn === 'list_church_events') {
        return {
          data: [{
            events: [sampleEvent],
            total_count: 1,
          }],
          error: null,
        };
      }
      if (fn === 'assign_event_liturgy_leader') {
        return {
          data: null,
          error: {
            code: '42501',
            message: 'Apenas administradores ativos podem designar a liderança da liturgia.',
          },
        };
      }
      return { data: [], error: null };
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        React.createElement(AppProvider, {
          initialUserId: 'marcos',
          churchId: CHURCH_ID,
          supabaseClient: mockClient,
          allowMemoryFallback: false,
        }, React.createElement(Consumer))
      );
    });

    assert.equal(appCtx.events[0].liturgyLeaderId, OLD_LEADER_ID);

    let result;
    await act(async () => {
      result = await appCtx.designateLiturgyLeader(NEW_LEADER_ID, EVENT_ID);
    });

    assert.equal(result?.success, false, 'Não deve reportar sucesso quando a RPC falha');
    assert.match(result?.error || '', /administradores/i, 'Mensagem deve tratar permissão 42501');
    assert.equal(appCtx.events[0].liturgyLeaderId, OLD_LEADER_ID, 'Líder local NÃO pode ser alterado');
  });

  test('(iii) Divergência de versão rejeita sem alterar líder local', async () => {
    const mockClient = createMockSupabase(async (fn, params) => {
      if (fn === 'list_church_events') {
        return {
          data: [{
            events: [sampleEvent],
            total_count: 1,
          }],
          error: null,
        };
      }
      if (fn === 'assign_event_liturgy_leader') {
        return {
          data: null,
          error: {
            code: 'P0020',
            message: 'Versão esperada divergente da versão atual do evento.',
          },
        };
      }
      return { data: [], error: null };
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        React.createElement(AppProvider, {
          initialUserId: 'marcos',
          churchId: CHURCH_ID,
          supabaseClient: mockClient,
          allowMemoryFallback: false,
        }, React.createElement(Consumer))
      );
    });

    let result;
    await act(async () => {
      result = await appCtx.designateLiturgyLeader(NEW_LEADER_ID, EVENT_ID, 999);
    });

    assert.equal(result?.success, false);
    assert.match(result?.error || '', /versão/i, 'Deve apontar divergência de versão');
    assert.equal(appCtx.events[0].liturgyLeaderId, OLD_LEADER_ID, 'Líder permanece o anterior');
  });

  test('(iv) commandId e expectedVersion corretos na chamada da RPC', async () => {
    let capturedParams = null;

    const mockClient = createMockSupabase(async (fn, params) => {
      if (fn === 'list_church_events') {
        return {
          data: [{
            events: [{ ...sampleEvent, version: 7 }],
            total_count: 1,
          }],
          error: null,
        };
      }
      if (fn === 'assign_event_liturgy_leader') {
        capturedParams = params;
        return canonicalLiturgyReceipt(params, params.p_event_id, 8);
      }
      return { data: [], error: null };
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        React.createElement(AppProvider, {
          initialUserId: 'marcos',
          churchId: CHURCH_ID,
          supabaseClient: mockClient,
          allowMemoryFallback: false,
        }, React.createElement(Consumer))
      );
    });

    await act(async () => {
      await appCtx.designateLiturgyLeader(NEW_LEADER_ID, EVENT_ID);
    });

    assert.ok(capturedParams, 'RPC deve ter sido chamada');
    assert.equal(capturedParams.p_church_id, CHURCH_ID);
    assert.equal(capturedParams.p_event_id, EVENT_ID);
    assert.equal(capturedParams.p_new_liturgy_leader_member_id, NEW_LEADER_ID);
    assert.equal(capturedParams.p_expected_version, 7, 'expectedVersion deve coincidir com version do evento');
    assert.match(capturedParams.p_command_id, /^[0-9a-f-]{36}$/i, 'commandId deve ser UUID válido');
  });

  test('(v) UNCERTAIN reutiliza o mesmo commandId na repetição da chamada', async () => {
    const commandIdsReceived = [];
    let attempt = 0;

    const mockClient = createMockSupabase(async (fn, params) => {
      if (fn === 'list_church_events') {
        return {
          data: [{
            events: [sampleEvent],
            total_count: 1,
          }],
          error: null,
        };
      }
      if (fn === 'assign_event_liturgy_leader') {
        attempt++;
        commandIdsReceived.push(params.p_command_id);
        if (attempt === 1) {
          // Erro incerto / timeout de rede
          return {
            data: null,
            error: { message: 'FetchError: Connection timeout' },
          };
        }
        // Tentativa 2: sucesso com mesmo commandId
        return canonicalLiturgyReceipt(params, params.p_event_id, 2);
      }
      return { data: [], error: null };
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        React.createElement(AppProvider, {
          initialUserId: 'marcos',
          churchId: CHURCH_ID,
          supabaseClient: mockClient,
          allowMemoryFallback: false,
        }, React.createElement(Consumer))
      );
    });

    // 1ª chamada -> incerta
    let res1;
    await act(async () => {
      res1 = await appCtx.designateLiturgyLeader(NEW_LEADER_ID, EVENT_ID);
    });
    assert.equal(res1?.success, false);
    assert.equal(res1?.uncertain, true);

    // 2ª chamada -> repetição do mesmo comando
    let res2;
    await act(async () => {
      res2 = await appCtx.designateLiturgyLeader(NEW_LEADER_ID, EVENT_ID);
    });
    assert.equal(res2?.success, true);

    assert.equal(commandIdsReceived.length, 2);
    assert.equal(
      commandIdsReceived[0],
      commandIdsReceived[1],
      'A segunda tentativa DEVE reutilizar exatamente o mesmo commandId do retorno incerto'
    );
  });

  test('(vi) Modo memória inalterado: atualiza localmente e adiciona audit log', async () => {
    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        React.createElement(AppProvider, { initialUserId: 'marcos', allowMemoryFallback: true }, React.createElement(Consumer))
      );
    });

    const targetEvId = appCtx.events[0]?.id;
    assert.ok(targetEvId, 'Deve haver um evento inicial em memória');
    const initialLogsCount = appCtx.auditLogs.length;

    let res;
    await act(async () => {
      res = await appCtx.designateLiturgyLeader(NEW_LEADER_ID, targetEvId);
    });

    assert.equal(res?.success, true);
    const updatedEv = appCtx.events.find(e => e.id === targetEvId);
    assert.equal(updatedEv.liturgyLeaderId, NEW_LEADER_ID);
    assert.equal(appCtx.auditLogs.length, initialLogsCount + 1, 'Modo memória deve registrar audit log local');
    assert.equal(appCtx.auditLogs[0].action, 'Designação da Liturgia');
  });

  test('(vii) Nenhum addAuditLog local no ramo real (o servidor audita)', async () => {
    const mockClient = createMockSupabase(async (fn, params) => {
      if (fn === 'list_church_events') {
        return {
          data: [{
            events: [sampleEvent],
            total_count: 1,
          }],
          error: null,
        };
      }
      if (fn === 'assign_event_liturgy_leader') {
        return canonicalLiturgyReceipt(params, params.p_event_id, 2);
      }
      return { data: [], error: null };
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        React.createElement(AppProvider, {
          initialUserId: 'marcos',
          churchId: CHURCH_ID,
          supabaseClient: mockClient,
          allowMemoryFallback: false,
        }, React.createElement(Consumer))
      );
    });

    const logsBefore = appCtx.auditLogs.length;

    await act(async () => {
      await appCtx.designateLiturgyLeader(NEW_LEADER_ID, EVENT_ID);
    });

    assert.equal(
      appCtx.auditLogs.length,
      logsBefore,
      'No ramo real NÃO deve chamar addAuditLog local, pois o servidor grava na tabela audit_entries'
    );
  });

  test('AdminView UI: handleDesignateLeader exibe erro se RPC falhar e sucesso apenas se success: true', async () => {
    let shouldFail = true;

    const mockClient = createMockSupabase(async (fn, params) => {
      if (fn === 'list_church_events') {
        return {
          data: [{
            events: [sampleEvent],
            total_count: 1,
          }],
          error: null,
        };
      }
      if (fn === 'assign_event_liturgy_leader') {
        if (shouldFail) {
          return {
            data: null,
            error: { code: '42501', message: 'Permissão insuficiente.' },
          };
        }
        return canonicalLiturgyReceipt(params, params.p_event_id, 2);
      }
      return { data: [], error: null };
    });

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(AppProvider, {
          initialUserId: 'marcos',
          churchId: CHURCH_ID,
          supabaseClient: mockClient,
          allowMemoryFallback: false,
        }, React.createElement(AdminView, { initialTab: 'liturgy' }))
      );
    });

    // Encontra o botão de salvar designação da liturgia
    const saveBtn = renderer.root.findByProps({ id: 'btn-save-admin-liturgy-designation' });
    assert.ok(saveBtn, 'Botão btn-save-admin-liturgy-designation deve existir');

    // Executa com falha na RPC
    await act(async () => {
      await saveBtn.props.onClick();
    });

    // Verifica que mensagem de sucesso NÃO foi renderizada e que o erro aparece
    const textAfterFail = JSON.stringify(renderer.toJSON());
    assert.doesNotMatch(textAfterFail, /atualizada com sucesso/i, 'NÃO deve mostrar mensagem de sucesso em falha da RPC');

    // Agora permite sucesso na RPC
    shouldFail = false;
    await act(async () => {
      await saveBtn.props.onClick();
    });

    const textAfterSuccess = JSON.stringify(renderer.toJSON());
    assert.match(textAfterSuccess, /atualizada com sucesso/i, 'Deve exibir sucesso quando RPC confirma');
  });

  test('(viii) Evento sem version: a RPC assign_event_liturgy_leader NÃO é chamada e retorna erro específico', async () => {
    let rpcCalled = false;

    const mockClient = createMockSupabase(async (fn, params) => {
      if (fn === 'list_church_events') {
        return {
          data: [{
            events: [{ ...sampleEvent, version: null }],
            total_count: 1,
          }],
          error: null,
        };
      }
      if (fn === 'assign_event_liturgy_leader') {
        rpcCalled = true;
        return canonicalLiturgyReceipt(params, params.p_event_id, 2);
      }
      return { data: [], error: null };
    });

    let appCtx = null;
    function Consumer() {
      appCtx = useApp();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        React.createElement(AppProvider, {
          initialUserId: 'marcos',
          churchId: CHURCH_ID,
          supabaseClient: mockClient,
          allowMemoryFallback: false,
        }, React.createElement(Consumer))
      );
    });

    let result;
    await act(async () => {
      result = await appCtx.designateLiturgyLeader(NEW_LEADER_ID, EVENT_ID);
    });

    assert.equal(result?.success, false);
    assert.equal(
      result?.error,
      "Versão do evento não informada. Recarregue os dados antes de designar a liderança."
    );
    assert.equal(rpcCalled, false, 'assign_event_liturgy_leader NÃO pode ser chamada se version estiver ausente');
  });

});
