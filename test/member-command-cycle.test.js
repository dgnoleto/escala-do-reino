import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDefinitiveServerError,
  isUncertainResponse,
  validateAndNormalizeMemberName,
  getMemberCommandStorageKey,
  savePendingMemberCommand,
  loadPendingMemberCommand,
  removePendingMemberCommand,
  clearAllMemberCommandStorage,
  determineAuthTransition,
  classifyReceiptCheckResult,
  dispatchMemberCreation,
} from '../src/utils/memberCommandService.js';

/**
 * Mock simples de sessionStorage em memória para ambiente Node.js.
 */
class MockSessionStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.get(key) ?? null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  get length() {
    return this.store.size;
  }
  key(index) {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

describe('1. Validação de Entrada e Normalização Unicode NFC no Cliente', () => {
  it('normaliza caracteres decompostos (NFD) para a forma canônica pré-composta (NFC)', () => {
    // 'Jose' + combining acute accent (\u0301)
    const nfdName = 'Jose\u0301';
    assert.equal(nfdName.length, 5); // 4 letras + 1 caractere combinante
    const res = validateAndNormalizeMemberName(nfdName);
    assert.equal(res.valid, true);
    assert.equal(res.normalizedName, 'José');
    assert.equal(res.normalizedName.length, 4); // 4 caracteres canônicos
    assert.equal(Buffer.from(res.normalizedName, 'utf8').length, 5); // 'J','o','s' (3 bytes) + 'é' (2 bytes UTF-8)
  });

  it('preserva apóstrofos, cedilhas e acentos comuns', () => {
    const raw = "  Conceição d'Ávila  ";
    const res = validateAndNormalizeMemberName(raw);
    assert.equal(res.valid, true);
    assert.equal(res.normalizedName, "Conceição d'Ávila");
    assert.equal(res.normalizedName.includes("'"), true);
    assert.equal(res.normalizedName.includes("ç"), true);
    assert.equal(res.normalizedName.includes("Á"), true);
  });

  it('rejeita nomes vazios ou contendo apenas espaços em branco', () => {
    assert.equal(validateAndNormalizeMemberName('').valid, false);
    assert.equal(validateAndNormalizeMemberName('    ').valid, false);
    assert.equal(validateAndNormalizeMemberName(null).valid, false);
  });

  it('valida limites estritos de comprimento entre 1 e 120 caracteres', () => {
    const validShort = 'A';
    const valid120 = 'A'.repeat(120);
    const invalid121 = 'A'.repeat(121);

    assert.equal(validateAndNormalizeMemberName(validShort).valid, true);
    assert.equal(validateAndNormalizeMemberName(valid120).valid, true);
    assert.equal(validateAndNormalizeMemberName(invalid121).valid, false);
  });
});

describe('2. Classificação de Erros: Rejeições Definitivas vs Respostas Incertas', () => {
  it('classifica códigos de erro Postgres como rejeições definitivas', () => {
    assert.equal(isDefinitiveServerError({ code: '42501', message: 'Acesso não autorizado' }), true);
    assert.equal(isDefinitiveServerError({ code: '23514', message: 'Nome deve ter entre 1 e 120 caracteres.' }), true);
    assert.equal(isDefinitiveServerError({ code: '23505', message: 'Comando já executado com parâmetros diferentes.' }), true);
    assert.equal(isDefinitiveServerError({ code: '22004', message: 'Identificador obrigatório' }), true);
    assert.equal(isDefinitiveServerError({ code: 'P0002', message: 'Igreja não encontrada' }), true);
    assert.equal(isDefinitiveServerError({ code: 'P0004', message: 'Limite de requisições excedido' }), true);
  });

  it('classifica erros HTTP 4xx como definitivos', () => {
    assert.equal(isDefinitiveServerError({ status: 400, message: 'Bad request' }), true);
    assert.equal(isDefinitiveServerError({ status: 403, message: 'Forbidden' }), true);
    assert.equal(isDefinitiveServerError({ status: 409, message: 'Conflict' }), true);
  });

  it('classifica falhas de transporte/rede e status 5xx como respostas incertas', () => {
    const fetchError = { message: 'Failed to fetch', status: 0 };
    const gatewayTimeout = { status: 504, message: 'Gateway Timeout' };
    const serverError = { status: 502, message: 'Bad Gateway' };

    assert.equal(isDefinitiveServerError(fetchError), false);
    assert.equal(isUncertainResponse(fetchError, null), true);

    assert.equal(isDefinitiveServerError(gatewayTimeout), false);
    assert.equal(isUncertainResponse(gatewayTimeout, null), true);

    assert.equal(isDefinitiveServerError(serverError), false);
    assert.equal(isUncertainResponse(serverError, null), true);
  });

  it('classifica resposta HTTP 200 com array vazio ou sem member_id como resposta incerta', () => {
    assert.equal(isUncertainResponse(null, []), true);
    assert.equal(isUncertainResponse(null, [{}]), true);
    assert.equal(isUncertainResponse(null, [{ member_id: 'valid-uuid' }]), false);
  });
});

describe('3. Ciclo de Comando, Idempotência e Retenção no Aplicativo (Produção)', () => {
  let storage;
  const userId = 'user-admin-123';
  const churchId = 'church-sp-456';

  beforeEach(() => {
    storage = new MockSessionStorage();
  });

  it('cria e retém a identidade do comando antes do envio no storage de sessão', () => {
    const commandId = 'cmd-uuid-1111';
    const displayName = 'Barnabé de Chipre';

    const saved = savePendingMemberCommand(storage, { userId, churchId, commandId, displayName });
    assert.equal(saved, true);

    const loaded = loadPendingMemberCommand(storage, userId, churchId);
    assert.equal(loaded?.commandId, commandId);
    assert.equal(loaded?.displayName, displayName);
    assert.equal(loaded?.churchId, churchId);
    assert.equal(loaded?.userId, userId);
  });

  it('interrompe e NÃO chama a RPC quando a persistência do comando no storage falha', async () => {
    let rpcCallCount = 0;
    const mockRpcCaller = async () => {
      rpcCallCount++;
      return { data: [{ member_id: 'should-not-be-called' }], error: null };
    };

    // 1. Simula storage com falha (ex.: sessionStorage desabilitado, sem permissão ou quota excedida)
    const failingStorage = {
      setItem: () => {
        throw new Error('QuotaExceededError: sessionStorage is full or disabled');
      },
      getItem: () => null,
      removeItem: () => {},
      length: 0,
      key: () => null,
    };

    const result = await dispatchMemberCreation({
      storage: failingStorage,
      rpcCaller: mockRpcCaller,
      churchId,
      userId,
      commandId: 'cmd-storage-failure-999',
      displayName: 'Lucas Evangelista',
    });

    // Comprova que o status reportado é STORAGE_FAILED
    assert.equal(result.status, 'STORAGE_FAILED');
    assert.equal(result.rpcCalled, false);
    assert.equal(result.message.includes('Armazenamento local da sessão indisponível'), true);

    // COMPROVAÇÃO CRÍTICA: A RPC NUNCA foi chamada!
    assert.equal(rpcCallCount, 0);

    // 2. Simula storage nulo (armazenamento totalmente indisponível)
    rpcCallCount = 0;
    const nullStorageResult = await dispatchMemberCreation({
      storage: null,
      rpcCaller: mockRpcCaller,
      churchId,
      userId,
      commandId: 'cmd-storage-null-888',
      displayName: 'Lucas Evangelista',
    });

    assert.equal(nullStorageResult.status, 'STORAGE_FAILED');
    assert.equal(nullStorageResult.rpcCalled, false);
    assert.equal(rpcCallCount, 0);
  });

  it('restauração inicial da mesma conta com comando pendente (F5 / recarga da página)', () => {
    // 1. Comando pendente gravado antes da recarga
    const commandId = 'cmd-reload-2222';
    const displayName = 'Estêvão Mártir';
    savePendingMemberCommand(storage, { userId, churchId, commandId, displayName });

    // 2. AuthContext processa restauração inicial: previousUserId é null
    const transition = determineAuthTransition({
      previousUserId: null,
      newUserId: userId,
      currentGen: 1,
      authGen: 1,
    });

    assert.equal(transition.type, 'INITIAL_SESSION');
    assert.equal(transition.shouldClearMemberStorage, false); // NÃO limpa!

    // Se não limpa, o comando continua intacto
    const restored = loadPendingMemberCommand(storage, userId, churchId);
    assert.notEqual(restored, null);
    assert.equal(restored.commandId, commandId);
    assert.equal(restored.displayName, displayName);
  });

  it('recarga após envio com resposta perdida preserva a identidade para reconciliação', () => {
    const commandId = 'cmd-lost-response-3333';
    const displayName = 'Timóteo de Éfeso';

    // Salva comando antes do envio
    savePendingMemberCommand(storage, { userId, churchId, commandId, displayName });

    // Simula resposta de transporte com erro (timeout de rede)
    const transportError = { message: 'Failed to fetch', status: 0 };
    assert.equal(isUncertainResponse(transportError, null), true);

    // O usuário recarrega a página antes de reconciliar
    const transition = determineAuthTransition({
      previousUserId: null,
      newUserId: userId,
      currentGen: 1,
      authGen: 1,
    });
    assert.equal(transition.shouldClearMemberStorage, false);

    // Na remontagem, o comando é recuperado exatamente com o mesmo commandId
    const pending = loadPendingMemberCommand(storage, userId, churchId);
    assert.equal(pending.commandId, commandId);
    assert.equal(pending.displayName, displayName);
  });

  it('troca de conta sem exposição de dados anteriores', () => {
    const userA = 'user-a-111';
    const userB = 'user-b-222';

    // Usuário A possui comando pendente
    savePendingMemberCommand(storage, { userId: userA, churchId, commandId: 'cmd-a', displayName: 'Membro Privado A' });

    // Transição de troca de conta: userA -> userB
    const transition = determineAuthTransition({
      previousUserId: userA,
      newUserId: userB,
      currentGen: 2,
      authGen: 2,
    });

    assert.equal(transition.type, 'ACCOUNT_SWITCH');
    assert.equal(transition.shouldClearMemberStorage, true);

    // Executa a limpeza exigida pela transição
    if (transition.shouldClearMemberStorage) {
      clearAllMemberCommandStorage(storage);
    }

    // Usuário B não acessa nenhum dado de A
    assert.equal(loadPendingMemberCommand(storage, userB, churchId), null);
    assert.equal(loadPendingMemberCommand(storage, userA, churchId), null);
  });

  it('recibo vazio preservando o comando (classifyReceiptCheckResult)', () => {
    const commandId = 'cmd-receipt-empty-4444';
    const displayName = 'Silas de Jerusalém';
    savePendingMemberCommand(storage, { userId, churchId, commandId, displayName });

    // Consulta de recibo retornou array vazio []
    const receiptResult = classifyReceiptCheckResult(null, []);
    assert.equal(receiptResult.status, 'EMPTY_RECEIPT');
    assert.equal(receiptResult.shouldPreserveCommand, true);

    // O comando NÃO é removido do storage
    const retained = loadPendingMemberCommand(storage, userId, churchId);
    assert.notEqual(retained, null);
    assert.equal(retained.commandId, commandId);
  });

  it('falha de conexão ou erro do servidor na consulta de recibo NÃO descarta o comando', () => {
    const commandId = 'cmd-receipt-err-5555';
    const displayName = 'Lídia de Tiatira';
    savePendingMemberCommand(storage, { userId, churchId, commandId, displayName });

    // Falha 500 ou transporte na consulta de recibo
    const serverErr = { status: 500, message: 'Internal Server Error' };
    const receiptResult = classifyReceiptCheckResult(serverErr, null);

    assert.equal(receiptResult.status, 'ERROR');
    assert.equal(receiptResult.shouldPreserveCommand, true);

    // O comando permanece preservado para retentativa
    const retained = loadPendingMemberCommand(storage, userId, churchId);
    assert.equal(retained.commandId, commandId);
  });

  it('reexecução com o mesmo identificador e parâmetros recupera registro ou conclui criação única', () => {
    const commandId = 'cmd-retry-6666';
    const displayName = 'Apolo de Alexandria';
    savePendingMemberCommand(storage, { userId, churchId, commandId, displayName });

    // Reexecução utilizando o mesmo commandId e displayName
    const pending = loadPendingMemberCommand(storage, userId, churchId);
    assert.equal(pending.commandId, commandId);
    assert.equal(pending.displayName, displayName);

    // Simula resposta do servidor confirmando idempotência (already_existed = true)
    const idempotentResponse = {
      data: [{ member_id: 'member-uuid-apolo', display_name: displayName, already_existed: true }],
      error: null,
    };
    assert.equal(isUncertainResponse(idempotentResponse.error, idempotentResponse.data), false);

    // Sucesso confirmado: remove do storage
    removePendingMemberCommand(storage, userId, churchId);
    assert.equal(loadPendingMemberCommand(storage, userId, churchId), null);
  });

  it('homônimos com comandos distintos criam membros com identificadores diferentes', () => {
    const sameName = 'João Batista';
    const res1 = { member_id: 'member-uuid-1', display_name: sameName, already_existed: false };
    const res2 = { member_id: 'member-uuid-2', display_name: sameName, already_existed: false };

    assert.notEqual(res1.member_id, res2.member_id);
    assert.equal(res1.display_name, res2.display_name);
  });
});

describe('4. Coordenação de Inicialização e Concorrência da Sessão no AuthContext', () => {
  it('evento SIGNED_OUT mais recente não é sobrescrito por getSession atrasado', () => {
    let authGen = 0;

    // 1. getSession dispara assincronamente na geração 1
    const getSessionGen = ++authGen;

    // 2. Antes de getSession resolver, onAuthStateChange dispara SIGNED_OUT na geração 2
    const signedOutGen = ++authGen;
    const signoutTransition = determineAuthTransition({
      previousUserId: 'user-active',
      newUserId: null,
      currentGen: signedOutGen,
      authGen,
    });
    assert.equal(signoutTransition.type, 'LOGOUT');
    assert.equal(signoutTransition.isStale, false);
    assert.equal(signoutTransition.shouldClearMemberStorage, true);

    // 3. getSession resolve tardiamente na geração 1
    const lateGetSessionTransition = determineAuthTransition({
      previousUserId: null,
      newUserId: 'user-active',
      currentGen: getSessionGen,
      authGen,
    });

    // O snapshot atrasado é estritamente ignorado como stale!
    assert.equal(lateGetSessionTransition.isStale, true);
  });

  it('renovação de token (mesmo usuário) não reseta contexto nem limpa storage', () => {
    const transition = determineAuthTransition({
      previousUserId: 'user-same-123',
      newUserId: 'user-same-123',
      currentGen: 1,
      authGen: 1,
    });

    assert.equal(transition.type, 'SAME_USER');
    assert.equal(transition.shouldClearMemberStorage, false);
    assert.equal(transition.isStale, false);
  });
});

describe('5. Ciclo de Envio com dispatchMemberCreation e Respostas Controladas da RPC', () => {
  let storage;
  const userId = 'user-admin-123';
  const churchId = 'church-sp-456';

  beforeEach(() => {
    storage = new MockSessionStorage();
  });

  it('1. Sucesso: o comando está salvo antes da chamada e é removido somente após confirmação válida', async () => {
    const commandId = 'cmd-success-101';
    const displayName = 'Filemom de Colossos';
    let storageCheckedDuringRpc = false;

    const mockRpcCaller = async (params) => {
      // Verifica os parâmetros recebidos pela RPC
      assert.equal(params.p_church_id, churchId);
      assert.equal(params.p_command_id, commandId);
      assert.equal(params.p_display_name, displayName);

      // Comprova que o comando já estava salvo no storage ANTES da RPC responder
      const inFlight = loadPendingMemberCommand(storage, userId, churchId);
      assert.notEqual(inFlight, null);
      assert.equal(inFlight.commandId, commandId);
      assert.equal(inFlight.displayName, displayName);
      storageCheckedDuringRpc = true;

      return {
        data: [{ member_id: 'mem-filemom-1', display_name: displayName, already_existed: false }],
        error: null,
      };
    };

    const result = await dispatchMemberCreation({
      storage,
      rpcCaller: mockRpcCaller,
      churchId,
      userId,
      commandId,
      displayName,
    });

    assert.equal(storageCheckedDuringRpc, true);
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.rpcCalled, true);
    assert.equal(result.created.member_id, 'mem-filemom-1');

    // Comprova que o comando é removido do storage SOMENTE após confirmação válida
    const afterSuccess = loadPendingMemberCommand(storage, userId, churchId);
    assert.equal(afterSuccess, null);
  });

  it('2. Falha de transporte retornada em error: o comando permanece com o mesmo identificador e parâmetros', async () => {
    const commandId = 'cmd-transport-202';
    const displayName = 'Febe de Cencréia';

    const transportError = { message: 'Failed to fetch', status: 0 };
    const mockRpcCaller = async () => ({
      data: null,
      error: transportError,
    });

    const result = await dispatchMemberCreation({
      storage,
      rpcCaller: mockRpcCaller,
      churchId,
      userId,
      commandId,
      displayName,
    });

    assert.equal(result.status, 'UNCERTAIN');
    assert.equal(result.rpcCalled, true);
    assert.equal(result.pendingCmd.commandId, commandId);

    // O comando permanece gravado no storage com os exatos mesmos identificador e parâmetros
    const retained = loadPendingMemberCommand(storage, userId, churchId);
    assert.notEqual(retained, null);
    assert.equal(retained.commandId, commandId);
    assert.equal(retained.displayName, displayName);
    assert.equal(retained.churchId, churchId);
    assert.equal(retained.userId, userId);
  });

  it('3. Exceção durante a chamada: a identidade também permanece preservada', async () => {
    const commandId = 'cmd-exception-303';
    const displayName = 'Tíquico da Ásia';

    const mockRpcCaller = async () => {
      throw new TypeError('Network connection lost mid-flight');
    };

    const result = await dispatchMemberCreation({
      storage,
      rpcCaller: mockRpcCaller,
      churchId,
      userId,
      commandId,
      displayName,
    });

    assert.equal(result.status, 'UNCERTAIN');
    assert.equal(result.rpcCalled, true);
    assert.equal(result.rpcError.message, 'Network connection lost mid-flight');

    // A identidade permanece rigorosamente preservada no storage
    const retained = loadPendingMemberCommand(storage, userId, churchId);
    assert.notEqual(retained, null);
    assert.equal(retained.commandId, commandId);
    assert.equal(retained.displayName, displayName);
  });

  it('4. Resposta vazia ou inválida: não apresenta sucesso nem libera uma nova identidade', async () => {
    const commandId = 'cmd-invalid-404';
    const displayName = 'Epafras de Hierápolis';

    // Simula resposta HTTP 200 com array vazio ou sem member_id
    const mockRpcCaller = async () => ({
      data: [],
      error: null,
    });

    const result = await dispatchMemberCreation({
      storage,
      rpcCaller: mockRpcCaller,
      churchId,
      userId,
      commandId,
      displayName,
    });

    // Não deve apresentar sucesso
    assert.notEqual(result.status, 'SUCCESS');
    assert.equal(result.status, 'UNCERTAIN');
    assert.equal(result.rpcCalled, true);

    // O comando continua retido no storage, impedindo que a operação seja descartada
    // e impedindo a geração de uma nova identidade antes da reconciliação
    const retained = loadPendingMemberCommand(storage, userId, churchId);
    assert.notEqual(retained, null);
    assert.equal(retained.commandId, commandId);
  });

  it('5. Rejeição definitiva da criação: encerra o comando conforme o contrato', async () => {
    const commandId = 'cmd-rejected-505';
    const displayName = 'Onésimo de Colossos';

    const definitiveError = {
      code: '42501',
      message: 'Acesso administrativo não autorizado nesta igreja.',
    };

    const mockRpcCaller = async () => ({
      data: null,
      error: definitiveError,
    });

    const result = await dispatchMemberCreation({
      storage,
      rpcCaller: mockRpcCaller,
      churchId,
      userId,
      commandId,
      displayName,
    });

    assert.equal(result.status, 'DEFINITIVE_ERROR');
    assert.equal(result.rpcCalled, true);
    assert.equal(result.rpcError.code, '42501');

    // Rejeição definitiva encerra o comando: remove do storage conforme o contrato
    const afterRejection = loadPendingMemberCommand(storage, userId, churchId);
    assert.equal(afterRejection, null);
  });

  it('6. Nova execução do comando incerto: envia exatamente o mesmo commandId, igreja e nome normalizado', async () => {
    const commandId = 'cmd-retry-606';
    const rawInputName = '   Tito de Creta   ';
    const validation = validateAndNormalizeMemberName(rawInputName);
    assert.equal(validation.valid, true);
    const normalizedName = validation.normalizedName;
    assert.equal(normalizedName, 'Tito de Creta');

    let rpcCallCount = 0;
    const capturedParams = [];

    const mockRpcCaller = async (params) => {
      rpcCallCount++;
      capturedParams.push(params);

      if (rpcCallCount === 1) {
        // Primeira chamada falha por oscilação de rede
        return { data: null, error: { message: 'Network timeout', status: 0 } };
      }

      // Segunda chamada (reexecução do comando pendente) obtém confirmação idempotente
      return {
        data: [{ member_id: 'mem-tito-606', display_name: normalizedName, already_existed: true }],
        error: null,
      };
    };

    // 1. Primeira tentativa enviando o nome normalizado
    const firstAttempt = await dispatchMemberCreation({
      storage,
      rpcCaller: mockRpcCaller,
      churchId,
      userId,
      commandId,
      displayName: normalizedName,
    });
    assert.equal(firstAttempt.status, 'UNCERTAIN');
    assert.equal(rpcCallCount, 1);

    // O comando está pendente no storage com o nome normalizado e commandId
    const pendingInStorage = loadPendingMemberCommand(storage, userId, churchId);
    assert.notEqual(pendingInStorage, null);
    assert.equal(pendingInStorage.displayName, normalizedName);
    assert.equal(pendingInStorage.commandId, commandId);

    // 2. Reexecução: recupera exatamente a mesma identidade e parâmetros do comando retido
    const retryAttempt = await dispatchMemberCreation({
      storage,
      rpcCaller: mockRpcCaller,
      churchId: pendingInStorage.churchId,
      userId: pendingInStorage.userId,
      commandId: pendingInStorage.commandId,
      displayName: pendingInStorage.displayName,
    });

    assert.equal(retryAttempt.status, 'SUCCESS');
    assert.equal(rpcCallCount, 2);

    // Comprova que a segunda chamada enviou rigorosamente os mesmos parâmetros
    assert.equal(capturedParams[1].p_church_id, capturedParams[0].p_church_id);
    assert.equal(capturedParams[1].p_command_id, capturedParams[0].p_command_id);
    assert.equal(capturedParams[1].p_display_name, capturedParams[0].p_display_name);
    assert.equal(capturedParams[1].p_command_id, commandId);
    assert.equal(capturedParams[1].p_display_name, normalizedName);

    // Após o sucesso da reexecução, o storage é liberado
    const afterRetry = loadPendingMemberCommand(storage, userId, churchId);
    assert.equal(afterRetry, null);
  });
});
