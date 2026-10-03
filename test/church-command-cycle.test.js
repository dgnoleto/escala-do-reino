import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateAndNormalizeChurchInput,
  savePendingChurchCommand,
  loadPendingChurchCommand,
  removePendingChurchCommand,
  clearAllChurchCommandStorage,
  isDefinitiveServerError,
  isUncertainResponse,
  classifyReceiptCheckResult,
  checkChurchCreationEligibility,
  checkChurchReceipt,
  dispatchChurchCreation,
  STORAGE_KEY_PREFIX,
} from '../src/utils/churchCommandService.js';

describe('1. Validação de Entrada e Normalização Unicode NFC no Cliente', () => {
  it('normaliza caracteres decompostos (NFD) para a forma canônica pré-composta (NFC)', () => {
    // Letra 'e' + combining acute accent (U+0301) decomposta
    const nfdChurchName = 'Igreja Esperanc\u0327a';
    const nfdCreatorName = 'Andre\u0301 Silva';

    const result = validateAndNormalizeChurchInput({
      name: nfdChurchName,
      creatorName: nfdCreatorName,
      timezone: 'America/Sao_Paulo',
      defaultDurationPolicy: 'warn',
    });

    assert.equal(result.isValid, true);
    assert.equal(result.normalizedData.name, 'Igreja Esperança');
    assert.equal(result.normalizedData.creatorName, 'André Silva');
  });

  it('preserva apóstrofos, cedilhas e acentos comuns em nomes', () => {
    const churchName = "Comunidade D'Ávila & São João";
    const creatorName = "D'Artagnan Gonçalves da Conceição";

    const result = validateAndNormalizeChurchInput({
      name: churchName,
      creatorName: creatorName,
      timezone: 'America/Sao_Paulo',
      defaultDurationPolicy: 'warn',
    });

    assert.equal(result.isValid, true);
    assert.equal(result.normalizedData.name, churchName);
    assert.equal(result.normalizedData.creatorName, creatorName);
  });

  it('rejeita nomes vazios ou contendo apenas espaços em branco', () => {
    const result1 = validateAndNormalizeChurchInput({
      name: '   ',
      creatorName: 'Valdir',
      timezone: 'America/Sao_Paulo',
    });
    assert.equal(result1.isValid, false);
    assert.ok(result1.errors.name);

    const result2 = validateAndNormalizeChurchInput({
      name: 'Igreja Central',
      creatorName: '   ',
      timezone: 'America/Sao_Paulo',
    });
    assert.equal(result2.isValid, false);
    assert.ok(result2.errors.creatorName);
  });

  it('valida limites estritos de comprimento (igreja 1-160, criador 1-120, endereço max 500)', () => {
    const tooLongChurchName = 'A'.repeat(161);
    const validChurchName = 'A'.repeat(160);
    const tooLongCreatorName = 'B'.repeat(121);
    const validCreatorName = 'B'.repeat(120);
    const tooLongAddress = 'C'.repeat(501);
    const validAddress = 'C'.repeat(500);

    const invalidResult = validateAndNormalizeChurchInput({
      name: tooLongChurchName,
      creatorName: tooLongCreatorName,
      timezone: 'America/Sao_Paulo',
      address: tooLongAddress,
      defaultDurationPolicy: 'warn',
    });

    assert.equal(invalidResult.isValid, false);
    assert.ok(invalidResult.errors.name);
    assert.ok(invalidResult.errors.creatorName);
    assert.ok(invalidResult.errors.address);

    const validResult = validateAndNormalizeChurchInput({
      name: validChurchName,
      creatorName: validCreatorName,
      timezone: 'America/Sao_Paulo',
      address: validAddress,
      defaultDurationPolicy: 'warn',
    });

    assert.equal(validResult.isValid, true);
    assert.equal(validResult.normalizedData.name.length, 160);
    assert.equal(validResult.normalizedData.creatorName.length, 120);
    assert.equal(validResult.normalizedData.address.length, 500);
  });

  it('valida que defaultDurationPolicy aceita warn e block, rejeitando outros valores', () => {
    const resWarn = validateAndNormalizeChurchInput({
      name: 'Igreja',
      creatorName: 'Pastor',
      timezone: 'America/Sao_Paulo',
      defaultDurationPolicy: 'warn',
    });
    assert.equal(resWarn.isValid, true);
    assert.equal(resWarn.normalizedData.defaultDurationPolicy, 'warn');

    const resBlock = validateAndNormalizeChurchInput({
      name: 'Igreja',
      creatorName: 'Pastor',
      timezone: 'America/Sao_Paulo',
      defaultDurationPolicy: 'block',
    });
    assert.equal(resBlock.isValid, true);
    assert.equal(resBlock.normalizedData.defaultDurationPolicy, 'block');

    const resInvalid = validateAndNormalizeChurchInput({
      name: 'Igreja',
      creatorName: 'Pastor',
      timezone: 'America/Sao_Paulo',
      defaultDurationPolicy: 'ignore',
    });
    assert.equal(resInvalid.isValid, false);
    assert.ok(resInvalid.errors.defaultDurationPolicy);
  });

  it('valida formato básico de URL do Google Maps quando preenchido', () => {
    const resInvalidUrl = validateAndNormalizeChurchInput({
      name: 'Igreja',
      creatorName: 'Pastor',
      timezone: 'America/Sao_Paulo',
      googleMapsUrl: 'not-a-valid-url',
    });
    assert.equal(resInvalidUrl.isValid, false);
    assert.ok(resInvalidUrl.errors.googleMapsUrl);

    const resValidUrl = validateAndNormalizeChurchInput({
      name: 'Igreja',
      creatorName: 'Pastor',
      timezone: 'America/Sao_Paulo',
      googleMapsUrl: 'https://maps.google.com/?q=Igreja',
    });
    assert.equal(resValidUrl.isValid, true);
    assert.equal(resValidUrl.normalizedData.googleMapsUrl, 'https://maps.google.com/?q=Igreja');
  });
});

describe('2. Classificação de Erros: Rejeições Definitivas vs Respostas Incertas', () => {
  it('classifica códigos de erro Postgres de regra como rejeições definitivas', () => {
    assert.equal(isDefinitiveServerError({ code: '42501', message: 'Acesso negado.' }), true);
    assert.equal(isDefinitiveServerError({ code: '23505', message: 'Unique violation.' }), true);
    assert.equal(isDefinitiveServerError({ code: '23514', message: 'Check violation.' }), true);
    assert.equal(isDefinitiveServerError({ code: 'P0004', message: 'Limite excedido.' }), true);
    assert.equal(isDefinitiveServerError({ message: 'Conta já possui administração ativa em outra igreja.' }), true);
  });

  it('classifica falhas de transporte/rede e status 5xx como respostas incertas', () => {
    assert.equal(isUncertainResponse({ message: 'Failed to fetch' }, null), true);
    assert.equal(isUncertainResponse({ message: 'NetworkError when attempting to fetch resource.' }, null), true);
    assert.equal(isUncertainResponse({ code: '500', message: 'Internal Server Error' }, null), true);
    assert.equal(isUncertainResponse({ code: '503', message: 'Service Unavailable' }, null), true);
    assert.equal(isUncertainResponse({ code: '408', message: 'Request Timeout' }, null), true);
  });

  it('não classifica rejeição definitiva como resposta incerta', () => {
    const errorDefinitive = { code: '42501', message: 'Conta inelegível para criar igreja.' };
    assert.equal(isDefinitiveServerError(errorDefinitive), true);
    assert.equal(isUncertainResponse(errorDefinitive, null), false);
  });
});

describe('3. Ciclo de Comando, Idempotência e Retenção no Storage de Sessão', () => {
  function createMockStorage() {
    const map = new Map();
    return {
      getItem(k) { return map.get(k) || null; },
      setItem(k, v) { map.set(k, String(v)); },
      removeItem(k) { map.delete(k); },
      clear() { map.clear(); },
      get length() { return map.size; },
      key(i) { return Array.from(map.keys())[i] || null; },
    };
  }

  it('salva e recupera comando pendente no storage de sessão com isolamento por usuário', () => {
    const storage = createMockStorage();
    const userId1 = 'user-111';
    const userId2 = 'user-222';

    const cmd1 = { commandId: 'cmd-aaa', churchData: { name: 'Igreja 1' } };
    const cmd2 = { commandId: 'cmd-bbb', churchData: { name: 'Igreja 2' } };

    savePendingChurchCommand(storage, userId1, cmd1);
    savePendingChurchCommand(storage, userId2, cmd2);

    assert.deepEqual(loadPendingChurchCommand(storage, userId1), cmd1);
    assert.deepEqual(loadPendingChurchCommand(storage, userId2), cmd2);

    removePendingChurchCommand(storage, userId1);
    assert.equal(loadPendingChurchCommand(storage, userId1), null);
    assert.deepEqual(loadPendingChurchCommand(storage, userId2), cmd2);
  });

  it('limpa todos os comandos pendentes de igreja de qualquer conta em logout', () => {
    const storage = createMockStorage();
    savePendingChurchCommand(storage, 'user-1', { commandId: 'c1' });
    savePendingChurchCommand(storage, 'user-2', { commandId: 'c2' });
    storage.setItem('other_app_data', 'preserve_me');

    clearAllChurchCommandStorage(storage);

    assert.equal(loadPendingChurchCommand(storage, 'user-1'), null);
    assert.equal(loadPendingChurchCommand(storage, 'user-2'), null);
    assert.equal(storage.getItem('other_app_data'), 'preserve_me');
  });

  it('interrompe e NÃO chama a RPC quando a persistência no storage falha', async () => {
    const brokenStorage = {
      getItem() { return null; },
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem() {},
    };

    let rpcCalled = false;
    const mockSupabase = {
      schema() {
        return {
          rpc() {
            rpcCalled = true;
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    };

    const res = await dispatchChurchCreation({
      supabaseClient: mockSupabase,
      storage: brokenStorage,
      userId: 'user-xyz',
      churchData: {
        name: 'Igreja Teste',
        creatorName: 'Pastor Teste',
        timezone: 'America/Sao_Paulo',
      },
    });

    assert.equal(res.status, 'STORAGE_ERROR');
    assert.equal(rpcCalled, false);
  });
});

describe('4. Verificação de Elegibilidade no Cliente', () => {
  it('identifica corretamente conta elegível', async () => {
    const mockSupabase = {
      schema() {
        return {
          rpc(name) {
            assert.equal(name, 'check_church_creation_eligibility');
            return Promise.resolve({
              data: [{ eligible: true, reason: 'eligible', active_admin_church_name: null }],
              error: null,
            });
          },
        };
      },
    };

    const res = await checkChurchCreationEligibility(mockSupabase);
    assert.equal(res.success, true);
    assert.equal(res.eligible, true);
    assert.equal(res.reason, 'eligible');
  });

  it('identifica conta já administradora com explicação da igreja administrada', async () => {
    const mockSupabase = {
      schema() {
        return {
          rpc() {
            return Promise.resolve({
              data: [{ eligible: false, reason: 'already_admin', active_admin_church_name: 'Ministério Shalom' }],
              error: null,
            });
          },
        };
      },
    };

    const res = await checkChurchCreationEligibility(mockSupabase);
    assert.equal(res.success, true);
    assert.equal(res.eligible, false);
    assert.equal(res.reason, 'already_admin');
    assert.equal(res.activeAdminChurchName, 'Ministério Shalom');
  });

  it('falha ao consultar elegibilidade não equivale a permissão (retorna success: false)', async () => {
    const mockSupabase = {
      schema() {
        return {
          rpc() {
            return Promise.resolve({
              data: null,
              error: { code: '500', message: 'Database connection failed' },
            });
          },
        };
      },
    };

    const res = await checkChurchCreationEligibility(mockSupabase);
    assert.equal(res.success, false);
    assert.equal(res.eligible, false);
    assert.ok(res.error);
  });
});

describe('5. Ciclo de Envio com dispatchChurchCreation e Recuperação de Recibos', () => {
  function createMockStorage() {
    const map = new Map();
    return {
      getItem(k) { return map.get(k) || null; },
      setItem(k, v) { map.set(k, String(v)); },
      removeItem(k) { map.delete(k); },
      clear() { map.clear(); },
      get length() { return map.size; },
      key(i) { return Array.from(map.keys())[i] || null; },
    };
  }

  it('cenário de sucesso: comando é persistido antes e limpo após confirmação válida', async () => {
    const storage = createMockStorage();
    const userId = 'user-abc';
    let rpcArgs = null;

    const mockSupabase = {
      schema() {
        return {
          rpc(name, args) {
            rpcArgs = args;
            return Promise.resolve({
              data: [{
                church_id: 'church-123',
                church_name: 'Igreja Nova',
                member_id: 'member-456',
                display_name: 'Pastor João',
                timezone: 'America/Sao_Paulo',
                default_duration_policy: 'warn',
                is_admin: true,
                already_existed: false,
              }],
              error: null,
            });
          },
        };
      },
    };

    const res = await dispatchChurchCreation({
      supabaseClient: mockSupabase,
      storage,
      userId,
      churchData: {
        name: 'Igreja Nova',
        creatorName: 'Pastor João',
        timezone: 'America/Sao_Paulo',
        defaultDurationPolicy: 'warn',
      },
    });

    assert.equal(res.status, 'SUCCESS');
    assert.equal(res.data.church_id, 'church-123');
    assert.equal(res.data.is_admin, true);
    assert.ok(rpcArgs.p_command_id);
    // Após sucesso confirmado, o comando pendente foi limpo do storage
    assert.equal(loadPendingChurchCommand(storage, userId), null);
  });

  it('cenário de resposta incerta (queda de conexão): retém identidade do comando no storage', async () => {
    const storage = createMockStorage();
    const userId = 'user-abc';

    const mockSupabase = {
      schema() {
        return {
          rpc() {
            return Promise.resolve({
              data: null,
              error: { message: 'Failed to fetch' },
            });
          },
        };
      },
    };

    const res = await dispatchChurchCreation({
      supabaseClient: mockSupabase,
      storage,
      userId,
      churchData: {
        name: 'Igreja Nova',
        creatorName: 'Pastor João',
        timezone: 'America/Sao_Paulo',
      },
    });

    assert.equal(res.status, 'UNCERTAIN');
    // Comando DEVE permanecer no storage para permitir reconciliação idempotente
    const retained = loadPendingChurchCommand(storage, userId);
    assert.ok(retained);
    assert.equal(retained.commandId, res.commandId);
  });

  it('reconciliação via checagem de recibo recupera a criação quando o recibo existe', () => {
    const receiptData = [{
      church_id: 'church-999',
      church_name: 'Igreja Confirmada',
      member_id: 'member-999',
      display_name: 'Pastor Silva',
      timezone: 'America/Sao_Paulo',
      default_duration_policy: 'warn',
      is_admin: true,
    }];

    const result = classifyReceiptCheckResult(receiptData, null);
    assert.equal(result.status, 'RECEIPT_FOUND');
    assert.equal(result.shouldRetainCommand, false);
    assert.equal(result.record.church_id, 'church-999');
  });

  it('recibo vazio ou erro de consulta na checagem NÃO descarta o comando pendente', () => {
    const resultEmpty = classifyReceiptCheckResult([], null);
    assert.equal(resultEmpty.status, 'RECEIPT_EMPTY');
    assert.equal(resultEmpty.shouldRetainCommand, true);

    const resultError = classifyReceiptCheckResult(null, new Error('Network timeout'));
    assert.equal(resultError.status, 'RECEIPT_ERROR');
    assert.equal(resultError.shouldRetainCommand, true);
  });
});
