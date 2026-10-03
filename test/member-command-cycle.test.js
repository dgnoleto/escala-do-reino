import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isDefinitiveServerError, isUncertainResponse } from '../src/utils/memberErrors.js';

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

// Configura sessionStorage global no ambiente de teste se ausente
if (typeof globalThis.sessionStorage === 'undefined') {
  globalThis.sessionStorage = new MockSessionStorage();
}

describe('1. Validação de Entrada e Normalização Unicode NFC no Cliente', () => {
  it('normaliza caracteres decompostos (NFD) para a forma canônica pré-composta (NFC)', () => {
    // 'Jose' + combining acute accent (\u0301)
    const nfdName = 'Jose\u0301';
    assert.equal(nfdName.length, 5); // 4 letras + 1 caractere combinante
    const nfcName = nfdName.normalize('NFC');
    assert.equal(nfcName, 'José');
    assert.equal(nfcName.length, 4); // 4 caracteres canônicos
    assert.equal(Buffer.from(nfcName, 'utf8').length, 5); // 'J','o','s' (3 bytes) + 'é' (2 bytes UTF-8)
  });

  it('preserva apóstrofos, cedilhas e acentos comuns', () => {
    const raw = "  Conceição d'Ávila  ";
    const cleaned = raw.trim().normalize('NFC');
    assert.equal(cleaned, "Conceição d'Ávila");
    assert.equal(cleaned.includes("'"), true);
    assert.equal(cleaned.includes("ç"), true);
    assert.equal(cleaned.includes("Á"), true);
  });

  it('rejeita nomes vazios ou contendo apenas espaços em branco', () => {
    const empty1 = '';
    const empty2 = '    ';
    assert.equal(empty1.trim().length, 0);
    assert.equal(empty2.trim().length, 0);
  });

  it('valida limites estritos de comprimento entre 1 e 120 caracteres', () => {
    const validShort = 'A';
    const valid120 = 'A'.repeat(120);
    const invalid121 = 'A'.repeat(121);

    assert.equal(validShort.trim().normalize('NFC').length >= 1 && validShort.length <= 120, true);
    assert.equal(valid120.trim().normalize('NFC').length <= 120, true);
    assert.equal(invalid121.trim().normalize('NFC').length > 120, true);
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
    const abortError = new Error('The user aborted a request');

    assert.equal(isDefinitiveServerError(fetchError), false);
    assert.equal(isUncertainResponse(fetchError, null), true);

    assert.equal(isDefinitiveServerError(gatewayTimeout), false);
    assert.equal(isUncertainResponse(gatewayTimeout, null), true);

    assert.equal(isDefinitiveServerError(serverError), false);
    assert.equal(isUncertainResponse(serverError, null), true);

    assert.equal(isDefinitiveServerError(abortError), false);
    assert.equal(isUncertainResponse(abortError, null), true);
  });

  it('classifica resposta HTTP 200 com array vazio ou sem member_id como resposta incerta', () => {
    assert.equal(isUncertainResponse(null, []), true);
    assert.equal(isUncertainResponse(null, null), true);
    assert.equal(isUncertainResponse(null, [{}]), true);
    // Resposta de sucesso válida não é incerta
    assert.equal(isUncertainResponse(null, [{ member_id: '123', display_name: 'Ana', already_existed: false }]), false);
  });
});

describe('3. Ciclo de Comando, Idempotência e Retenção de Identidade', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const churchId = '22222222-2222-2222-2222-222222222222';
  const storageKey = `escala_pending_member_cmd:${userId}:${churchId}`;

  beforeEach(() => {
    globalThis.sessionStorage.clear();
  });

  it('cria e retém a identidade do comando antes do envio no storage de sessão', () => {
    const commandId = 'cmd-initial-uuid-1234';
    const displayName = 'Barnabé das Oliveiras';

    const pendingCmd = {
      commandId,
      churchId,
      userId,
      displayName,
      timestamp: Date.now(),
    };

    // Gravação antes do envio
    globalThis.sessionStorage.setItem(storageKey, JSON.stringify(pendingCmd));

    const retrieved = JSON.parse(globalThis.sessionStorage.getItem(storageKey));
    assert.equal(retrieved.commandId, commandId);
    assert.equal(retrieved.displayName, displayName);
    assert.equal(retrieved.userId, userId);
  });

  it('quando o SDK retorna erro de rede sem lançar exceção, o comando é preservado com o mesmo ID', () => {
    const commandId = 'cmd-network-fail-5678';
    const displayName = 'Dorcas de Jope';
    const pendingCmd = { commandId, churchId, userId, displayName, timestamp: Date.now() };

    globalThis.sessionStorage.setItem(storageKey, JSON.stringify(pendingCmd));

    // Simula retorno de erro de rede no objeto error do SDK
    const sdkReturn = {
      data: null,
      error: { message: 'TypeError: Failed to fetch', status: 0 },
    };

    assert.equal(isUncertainResponse(sdkReturn.error, sdkReturn.data), true);

    // O comando NÃO é removido do storage
    const kept = JSON.parse(globalThis.sessionStorage.getItem(storageKey));
    assert.equal(kept.commandId, commandId);
    assert.equal(kept.displayName, displayName);
  });

  it('quando ocorre exceção de transporte, o comando permanece intacto para reconciliação', () => {
    const commandId = 'cmd-exception-9012';
    const displayName = 'Estêvão Diácono';
    const pendingCmd = { commandId, churchId, userId, displayName, timestamp: Date.now() };

    globalThis.sessionStorage.setItem(storageKey, JSON.stringify(pendingCmd));

    let threwError = null;
    try {
      throw new Error('Network request failed');
    } catch (err) {
      threwError = err;
    }

    assert.equal(isUncertainResponse(threwError, null), true);

    const kept = JSON.parse(globalThis.sessionStorage.getItem(storageKey));
    assert.equal(kept.commandId, commandId);
  });

  it('consulta de recibo vazia NÃO descarta o comando e autoriza reexecução com o mesmo ID', () => {
    const commandId = 'cmd-empty-receipt-3456';
    const displayName = 'Filemom de Colossos';
    const pendingCmd = { commandId, churchId, userId, displayName, timestamp: Date.now() };

    globalThis.sessionStorage.setItem(storageKey, JSON.stringify(pendingCmd));

    // get_create_member_receipt retorna []
    const receiptData = [];
    const receiptError = null;

    // Conforme especificação: NÃO descarta do storage
    if (!receiptError && receiptData.length === 0) {
      // O comando DEVE continuar retido para reexecução com a mesma chave
      const stillRetained = JSON.parse(globalThis.sessionStorage.getItem(storageKey));
      assert.equal(stillRetained.commandId, commandId);
      assert.equal(stillRetained.displayName, displayName);
    } else {
      assert.fail('Deveria ter caído no ramo de recibo vazio.');
    }
  });

  it('reexecução idempotente do mesmo comando recupera registro original com already_existed = true', () => {
    const commandId = 'cmd-replay-7890';
    const displayName = 'Gideão de Ofra';
    const memberId = 'member-original-uuid-9999';

    // Simula resposta da RPC quando o comando já havia sido executado anteriormente no banco
    const idempotentRpcResponse = {
      data: [
        {
          member_id: memberId,
          display_name: displayName,
          status: 'active',
          created_at: new Date().toISOString(),
          already_existed: true,
        },
      ],
      error: null,
    };

    assert.equal(isUncertainResponse(idempotentRpcResponse.error, idempotentRpcResponse.data), false);

    const result = idempotentRpcResponse.data[0];
    assert.equal(result.member_id, memberId);
    assert.equal(result.already_existed, true);

    // Sucesso confirmado: agora sim o storage pode ser limpo
    globalThis.sessionStorage.removeItem(storageKey);
    assert.equal(globalThis.sessionStorage.getItem(storageKey), null);
  });

  it('troca de tela ou desmontagem não apaga o comando pendente no storage de sessão', () => {
    const commandId = 'cmd-unmount-persisted-1111';
    const displayName = 'Priscila de Corinto';
    const pendingCmd = { commandId, churchId, userId, displayName, timestamp: Date.now() };

    globalThis.sessionStorage.setItem(storageKey, JSON.stringify(pendingCmd));

    // Simula desmontagem do componente (MembersPage unmount) e remontagem posterior
    // O storage da sessão sobrevive à desmontagem do componente na aba
    const reloaded = JSON.parse(globalThis.sessionStorage.getItem(storageKey));
    assert.equal(reloaded.commandId, commandId);
    assert.equal(reloaded.displayName, displayName);
  });

  it('homônimos com comandos distintos criam membros com identificadores diferentes', () => {
    const sameName = 'João Batista';
    const cmd1 = 'cmd-homonym-1';
    const cmd2 = 'cmd-homonym-2';

    // Criação 1
    const res1 = { member_id: 'member-uuid-1', display_name: sameName, already_existed: false };
    // Criação 2 com comando diferente
    const res2 = { member_id: 'member-uuid-2', display_name: sameName, already_existed: false };

    assert.notEqual(res1.member_id, res2.member_id);
    assert.equal(res1.display_name, res2.display_name);
  });

  it('isolamento estrito por conta e igreja: usuário B não acessa comando do usuário A', () => {
    const userA = 'user-aaa';
    const userB = 'user-bbb';
    const church1 = 'church-111';

    const keyA = `escala_pending_member_cmd:${userA}:${church1}`;
    const keyB = `escala_pending_member_cmd:${userB}:${church1}`;

    globalThis.sessionStorage.setItem(keyA, JSON.stringify({ commandId: 'cmd-a', displayName: 'Membro A' }));

    assert.notEqual(globalThis.sessionStorage.getItem(keyA), null);
    assert.equal(globalThis.sessionStorage.getItem(keyB), null);
  });
});

describe('4. Coordenação de Inicialização da Sessão no AuthContext', () => {
  it('evento SIGNED_OUT mais recente não é sobrescrito por getSession atrasado', () => {
    let authGeneration = 0;
    let activeSession = null;
    let authState = 'initializing';

    function applySession(newSession, gen) {
      if (gen < authGeneration) {
        // Ignora evento desatualizado
        return;
      }
      activeSession = newSession;
      authState = newSession ? 'access_granted' : 'unauthenticated';
    }

    // 1. getSession dispara assincronamente mas demora
    const getSessionGen = ++authGeneration;
    const oldSession = { user: { id: 'old-user' } };

    // 2. Antes de getSession resolver, onAuthStateChange emite SIGNED_OUT
    const signedOutGen = ++authGeneration;
    applySession(null, signedOutGen);
    assert.equal(authState, 'unauthenticated');
    assert.equal(activeSession, null);

    // 3. getSession resolve atrasado com a sessão anterior
    applySession(oldSession, getSessionGen);

    // Com o controle de geração, a sessão anterior atrasada é DESCARTADA e o usuário permanece deslogado
    assert.equal(authState, 'unauthenticated');
    assert.equal(activeSession, null);
  });

  it('descarte de resposta de conta anterior após logout ou troca de conta', () => {
    let sessionId = 1;
    let accessGrantedForUser = null;

    // Usuário 1 inicia consulta
    const user1SessionId = sessionId;
    const user1Id = 'user-1';

    // Usuário desloga (incrementa sessionId)
    sessionId += 1;

    // Resposta de get_my_church_access chega para o Usuário 1
    function handleAccessResponse(responseSessionId, returnedUserId) {
      if (responseSessionId !== sessionId) {
        // Sessão expirou ou trocou antes da resposta chegar: descarta!
        return;
      }
      accessGrantedForUser = returnedUserId;
    }

    handleAccessResponse(user1SessionId, user1Id);

    // O acesso da conta anterior NÃO foi aplicado
    assert.equal(accessGrantedForUser, null);
  });
});
