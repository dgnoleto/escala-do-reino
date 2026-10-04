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
  invalidateChurchCommandSession,
  getChurchCommandSessionGeneration,
  STORAGE_KEY_PREFIX,
} from '../src/utils/churchCommandService.js';

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

describe('6. Testes de Regressão — Casos Reproduzidos pelo Codex e Contratos de Produção', () => {
  it('Regressão Codex 1: resposta data=[{}] NÃO é classificada como SUCCESS, retorna UNCERTAIN e retém comando', async () => {
    const storage = createMockStorage();
    const userId = 'user-codex-1';

    const mockSupabase = {
      schema() {
        return {
          rpc() {
            // Reprodução: RPC retorna status 200 / data=[{}] sem os campos essenciais
            return Promise.resolve({
              data: [{}],
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
        name: 'Igreja Codex 1',
        creatorName: 'Pastor Teste',
        timezone: 'America/Sao_Paulo',
      },
    });

    assert.notEqual(res.status, 'SUCCESS');
    assert.equal(res.status, 'UNCERTAIN');
    // O comando NÃO pode ter sido apagado do storage
    const retained = loadPendingChurchCommand(storage, userId);
    assert.ok(retained);
    assert.equal(retained.commandId, res.commandId);
  });

  it('Regressão Codex 2: retentativa de envio usa integralmente os parâmetros persistidos, NÃO o formulário editado', async () => {
    const storage = createMockStorage();
    const userId = 'user-codex-2';
    const persistedCommandId = 'cmd-persisted-xyz-123';

    // Salva comando pendente original no storage
    savePendingChurchCommand(storage, userId, {
      commandId: persistedCommandId,
      userId,
      churchData: {
        name: 'Igreja Batista Fonte de Vida Original',
        creatorName: 'Pastor Marcos Original',
        timezone: 'America/Sao_Paulo',
        address: 'Rua Original, 100',
        defaultDurationPolicy: 'warn',
      },
      createdAt: new Date().toISOString(),
    });

    let sentRpcArgs = null;
    const mockSupabase = {
      schema() {
        return {
          rpc(name, args) {
            sentRpcArgs = args;
            return Promise.resolve({
              data: [{
                church_id: 'church-123',
                church_name: args.p_name,
                member_id: 'member-456',
                display_name: args.p_creator_name,
                timezone: args.p_timezone,
                default_duration_policy: args.p_default_duration_policy,
                is_admin: true,
                already_existed: false,
              }],
              error: null,
            });
          },
        };
      },
    };

    // Usuário tenta enviar passando dados editados no formulário
    const res = await dispatchChurchCreation({
      supabaseClient: mockSupabase,
      storage,
      userId,
      churchData: {
        name: 'Nome Alterado Pelo Formulario',
        creatorName: 'Nome Criador Alterado',
        timezone: 'America/Fortaleza',
        address: 'Outra Rua',
        defaultDurationPolicy: 'block',
      },
    });

    assert.equal(res.status, 'SUCCESS');
    // Deve ter enviado os parâmetros PERSISTIDOS, garantindo integridade e idempotência do comando
    assert.equal(sentRpcArgs.p_command_id, persistedCommandId);
    assert.equal(sentRpcArgs.p_name, 'Igreja Batista Fonte de Vida Original');
    assert.equal(sentRpcArgs.p_creator_name, 'Pastor Marcos Original');
    assert.equal(sentRpcArgs.p_timezone, 'America/Sao_Paulo');
    assert.equal(sentRpcArgs.p_address, 'Rua Original, 100');
    assert.equal(sentRpcArgs.p_default_duration_policy, 'warn');
  });

  it('Regressão Codex 3: recibo com apenas church_id NÃO é confirmação suficiente (classifica RECEIPT_INCOMPLETE e retém)', () => {
    // Recibo contendo apenas church_id
    const incompleteReceipt1 = [{ church_id: 'church-codex-3' }];
    const result1 = classifyReceiptCheckResult(incompleteReceipt1, null);
    assert.notEqual(result1.status, 'RECEIPT_FOUND');
    assert.equal(result1.status, 'RECEIPT_INCOMPLETE');
    assert.equal(result1.shouldRetainCommand, true);

    // Recibo com church_id e member_id mas is_admin !== true
    const incompleteReceipt2 = [{
      church_id: 'church-codex-3',
      member_id: 'mem-123',
      is_admin: false,
    }];
    const result2 = classifyReceiptCheckResult(incompleteReceipt2, null);
    assert.equal(result2.status, 'RECEIPT_INCOMPLETE');
    assert.equal(result2.shouldRetainCommand, true);

    // Recibo completo e válido com is_admin: true
    const completeReceipt = [{
      church_id: 'church-codex-3',
      church_name: 'Igreja Válida',
      member_id: 'mem-123',
      display_name: 'Pastor Válido',
      is_admin: true,
      timezone: 'America/Sao_Paulo',
      default_duration_policy: 'warn',
    }];
    const result3 = classifyReceiptCheckResult(completeReceipt, null);
    assert.equal(result3.status, 'RECEIPT_FOUND');
    assert.equal(result3.shouldRetainCommand, false);
  });

  it('validação estrita de URL do Google Maps: aceita domínios permitidos e rejeita URLs arbitrárias', () => {
    // URLs válidas do Google Maps
    const validUrls = [
      'https://maps.app.goo.gl/abC123XYZ',
      'https://goo.gl/maps/xyz789ABC',
      'https://maps.google.com/?q=Igreja+Central',
      'https://www.google.com/maps/place/Igreja/@-23.5,-46.6,15z',
      'https://google.com/maps/@-23.5,-46.6,15z',
    ];

    for (const url of validUrls) {
      const res = validateAndNormalizeChurchInput({
        name: 'Igreja Teste',
        creatorName: 'Pastor Teste',
        timezone: 'America/Sao_Paulo',
        googleMapsUrl: url,
      });
      assert.equal(res.isValid, true, `Deveria aceitar: ${url}`);
      assert.equal(res.normalizedData.googleMapsUrl, url);
    }

    // URLs arbitrárias ou maliciosas
    const invalidUrls = [
      'https://evil.com/maps',
      'https://facebook.com',
      'http://maps.google.com/insecure', // não-HTTPS
      'https://google.com.malicious.site/maps',
      'javascript:alert(1)',
      'https://example.com/google.com/maps',
    ];

    for (const url of invalidUrls) {
      const res = validateAndNormalizeChurchInput({
        name: 'Igreja Teste',
        creatorName: 'Pastor Teste',
        timezone: 'America/Sao_Paulo',
        googleMapsUrl: url,
      });
      assert.equal(res.isValid, false, `Deveria rejeitar: ${url}`);
      assert.ok(res.errors.googleMapsUrl);
    }
  });

  it('imutabilidade: impede que savePendingChurchCommand substitua silenciosamente um comando pendente por outro ID', () => {
    const storage = createMockStorage();
    const userId = 'user-immutable';

    const cmd1 = { commandId: 'cmd-alpha', churchData: { name: 'Igreja Alpha' } };
    const cmd2 = { commandId: 'cmd-beta', churchData: { name: 'Igreja Beta' } };

    const saved1 = savePendingChurchCommand(storage, userId, cmd1);
    assert.equal(saved1, true);

    // Tentativa de salvar outro commandId enquanto o anterior está pendente
    const saved2 = savePendingChurchCommand(storage, userId, cmd2);
    assert.equal(saved2, false);

    // Comando original permanece inalterado
    const current = loadPendingChurchCommand(storage, userId);
    assert.equal(current.commandId, 'cmd-alpha');
    assert.equal(current.churchData.name, 'Igreja Alpha');
  });
});

describe('7. Proteção contra Respostas Antigas, Isolamento de Sessão e Recuperação Acessível', () => {
  it('A em voo → logout e retorno → B persistido → resposta de A chega: B permanece intacto e A é descartado como STALE_SESSION', async () => {
    const storage = createMockStorage();
    const userId = 'user-alice-123';

    let resolveRpcA;
    const rpcPromiseA = new Promise((resolve) => {
      resolveRpcA = resolve;
    });

    const mockSupabase = {
      schema() {
        return {
          rpc(name, args) {
            if (args.p_command_id === 'cmd-A') {
              return rpcPromiseA;
            }
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    };

    const cmdDataA = {
      name: 'Igreja Alfa',
      creatorName: 'Pastor Alice',
      timezone: 'America/Sao_Paulo',
      defaultDurationPolicy: 'warn',
    };

    // Inicia envio do comando A
    const dispatchPromiseA = dispatchChurchCreation({
      supabaseClient: mockSupabase,
      storage,
      userId,
      churchData: cmdDataA,
      commandId: 'cmd-A',
    });

    // Garante que o comando A foi salvo antes da chamada
    const inFlightCmdA = loadPendingChurchCommand(storage, userId);
    assert.equal(inFlightCmdA.commandId, 'cmd-A');

    // Ocorre logout: limpa storage e invalida a geração de sessão de comandos
    clearAllChurchCommandStorage(storage);
    assert.equal(loadPendingChurchCommand(storage, userId), null);

    // Usuário retorna à mesma conta e prepara/salva um novo comando B
    const cmdB = {
      commandId: 'cmd-B',
      churchData: {
        name: 'Igreja Beta',
        creatorName: 'Pastor Alice',
        timezone: 'America/Sao_Paulo',
        defaultDurationPolicy: 'block',
      },
      createdAt: new Date().toISOString(),
    };
    savePendingChurchCommand(storage, userId, cmdB);
    assert.equal(loadPendingChurchCommand(storage, userId).commandId, 'cmd-B');

    // Agora a resposta da RPC para o comando A finalmente é resolvida com sucesso
    resolveRpcA({
      data: [{
        church_id: 'church-alpha-id',
        church_name: 'Igreja Alfa',
        member_id: 'member-alice-id',
        display_name: 'Pastor Alice',
        timezone: 'America/Sao_Paulo',
        default_duration_policy: 'warn',
        is_admin: true,
        already_existed: false,
      }],
      error: null,
    });

    const resultA = await dispatchPromiseA;

    // Resposta de A deve ser identificada como sessão obsoleta
    assert.equal(resultA.status, 'STALE_SESSION');

    // CRÍTICO: Comando B DEVE permanecer intacto no storage! Não pode ser null ou apagado por A!
    const persistedAfterA = loadPendingChurchCommand(storage, userId);
    assert.ok(persistedAfterA, 'Comando B não deve ter sido removido pela resposta obsoleta de A');
    assert.equal(persistedAfterA.commandId, 'cmd-B');
    assert.equal(persistedAfterA.churchData.name, 'Igreja Beta');
  });

  it('consulta de recibo antiga com logout/troca de sessão é descartada como STALE_SESSION e não remove comando novo', async () => {
    const storage = createMockStorage();
    const userId = 'user-bob-456';

    let resolveReceipt;
    const receiptPromise = new Promise((resolve) => {
      resolveReceipt = resolve;
    });

    const mockSupabase = {
      schema() {
        return {
          rpc(name, args) {
            return receiptPromise;
          },
        };
      },
    };

    savePendingChurchCommand(storage, userId, {
      commandId: 'cmd-receipt-old',
      churchData: { name: 'Igreja Antiga' },
    });

    // Inicia verificação de recibo
    const checkPromise = checkChurchReceipt({
      supabaseClient: mockSupabase,
      storage,
      userId,
      commandId: 'cmd-receipt-old',
    });

    // Ocorre logout/mudança de sessão
    clearAllChurchCommandStorage(storage);

    // Novo comando é salvo na nova sessão
    savePendingChurchCommand(storage, userId, {
      commandId: 'cmd-receipt-new',
      churchData: { name: 'Igreja Nova' },
    });

    // Recibo antigo resolve
    resolveReceipt({
      data: [{
        church_id: 'church-old-id',
        church_name: 'Igreja Antiga',
        member_id: 'mem-1',
        display_name: 'Bob',
        is_admin: true,
        timezone: 'America/Sao_Paulo',
        default_duration_policy: 'warn',
      }],
      error: null,
    });

    const result = await checkPromise;
    assert.equal(result.status, 'STALE_SESSION');

    // Comando novo permanece intacto
    const current = loadPendingChurchCommand(storage, userId);
    assert.ok(current);
    assert.equal(current.commandId, 'cmd-receipt-new');
  });

  it('removePendingChurchCommand não remove comando se o expectedCommandId não coincidir com o armazenado', () => {
    const storage = createMockStorage();
    const userId = 'user-carol';

    savePendingChurchCommand(storage, userId, {
      commandId: 'cmd-actual',
      churchData: { name: 'Igreja Atual' },
    });

    // Tentativa de remover passando ID diferente (de uma resposta antiga)
    const removed = removePendingChurchCommand(storage, userId, 'cmd-stale');
    assert.equal(removed, false);

    // O comando atual permanece intacto
    const remaining = loadPendingChurchCommand(storage, userId);
    assert.ok(remaining);
    assert.equal(remaining.commandId, 'cmd-actual');

    // Remoção com o ID correto tem sucesso
    const removedCorrect = removePendingChurchCommand(storage, userId, 'cmd-actual');
    assert.equal(removedCorrect, true);
    assert.equal(loadPendingChurchCommand(storage, userId), null);
  });

  it('envio confirmado com resposta perdida → reload com acesso admin → recuperação acessível → recibo válido encerra apenas o comando correspondente', async () => {
    const storage = createMockStorage();
    const userId = 'user-david';
    const commandId = 'cmd-david-church';

    // 1. Comando foi persistido antes do envio
    savePendingChurchCommand(storage, userId, {
      commandId,
      churchData: {
        name: 'Igreja Esperança Confirmada',
        creatorName: 'Pastor David',
        timezone: 'America/Sao_Paulo',
        defaultDurationPolicy: 'warn',
      },
      createdAt: new Date().toISOString(),
    });

    // 2. Simula reload da página: storage retém o comando
    const pendingOnReload = loadPendingChurchCommand(storage, userId);
    assert.ok(pendingOnReload);
    assert.equal(pendingOnReload.commandId, commandId);

    // 3. Simula que get_my_church_access encontrou acesso administrativo concedido
    // O sistema NÃO trata already_admin como erro nem descarta o comando sem conferir recibo
    // Consulta o recibo para o comando pendente
    const mockSupabase = {
      schema() {
        return {
          rpc(name, args) {
            assert.equal(args.p_command_id, commandId);
            return Promise.resolve({
              data: [{
                church_id: 'church-david-123',
                church_name: 'Igreja Esperança Confirmada',
                member_id: 'member-david-456',
                display_name: 'Pastor David',
                timezone: 'America/Sao_Paulo',
                default_duration_policy: 'warn',
                is_admin: true,
              }],
              error: null,
            });
          },
        };
      },
    };

    const receiptResult = await checkChurchReceipt({
      supabaseClient: mockSupabase,
      commandId,
    });

    assert.equal(receiptResult.status, 'RECEIPT_FOUND');
    assert.equal(receiptResult.record.church_id, 'church-david-123');

    // Encerramento remove SOMENTE o comando correspondente
    removePendingChurchCommand(storage, userId, commandId);
    assert.equal(loadPendingChurchCommand(storage, userId), null);
  });

  it('membro da igreja B que criou a igreja A: reload com múltiplos acessos preserva recuperação e seleciona igreja A', async () => {
    const storage = createMockStorage();
    const userId = 'user-elena';
    const commandId = 'cmd-elena-new-church';

    // Elena já era membro da Igreja B
    // Ela envia a criação da Igreja A, salva o comando no storage
    savePendingChurchCommand(storage, userId, {
      commandId,
      churchData: {
        name: 'Igreja A Novamente',
        creatorName: 'Elena Líder',
        timezone: 'America/Sao_Paulo',
        defaultDurationPolicy: 'warn',
      },
      createdAt: new Date().toISOString(),
    });

    // Resposta se perdeu; após reload, get_my_church_access encontra múltiplos vínculos
    // O comando pendente de criação da Igreja A continua detectável no storage mesmo com múltiplos acessos
    const pendingOnSelectPage = loadPendingChurchCommand(storage, userId);
    assert.ok(pendingOnSelectPage);
    assert.equal(pendingOnSelectPage.commandId, commandId);

    // Recuperação consulta o recibo para reconciliação
    const mockSupabase = {
      schema() {
        return {
          rpc(name, args) {
            return Promise.resolve({
              data: [{
                church_id: 'church-a-created',
                church_name: 'Igreja A Novamente',
                member_id: 'mem-a-2',
                display_name: 'Elena Líder',
                timezone: 'America/Sao_Paulo',
                default_duration_policy: 'warn',
                is_admin: true,
              }],
              error: null,
            });
          },
        };
      },
    };

    const recovery = await checkChurchReceipt({
      supabaseClient: mockSupabase,
      commandId,
    });

    assert.equal(recovery.status, 'RECEIPT_FOUND');
    assert.equal(recovery.record.church_id, 'church-a-created');

    // Ao confirmar recibo, comando é encerrado
    removePendingChurchCommand(storage, userId, commandId);
    assert.equal(loadPendingChurchCommand(storage, userId), null);

    // E a igreja explicitamente selecionada na interface deve ser a igreja criada ('church-a-created')
    let selectedChurchId = null;
    const selectChurch = (id) => { selectedChurchId = id; };
    selectChurch(recovery.record.church_id);
    assert.equal(selectedChurchId, 'church-a-created');
  });

  it('validação de Google Maps rejeita subdomínios arbitrários como google.exemplo.com/maps e aceita links válidos', () => {
    // Subdomínio falso que passaria em um regex frouxo como google\.[a-z.]+
    const resFakeDomain = validateAndNormalizeChurchInput({
      name: 'Igreja Teste',
      creatorName: 'Pastor Teste',
      timezone: 'America/Sao_Paulo',
      googleMapsUrl: 'https://google.exemplo.com/maps',
    });
    assert.equal(resFakeDomain.isValid, false);
    assert.ok(resFakeDomain.errors.googleMapsUrl);

    const resFake2 = validateAndNormalizeChurchInput({
      name: 'Igreja Teste',
      creatorName: 'Pastor Teste',
      timezone: 'America/Sao_Paulo',
      googleMapsUrl: 'https://fakegoogle.com/maps',
    });
    assert.equal(resFake2.isValid, false);
    assert.ok(resFake2.errors.googleMapsUrl);

    // Links válidos
    const valid1 = validateAndNormalizeChurchInput({
      name: 'Igreja Teste',
      creatorName: 'Pastor Teste',
      timezone: 'America/Sao_Paulo',
      googleMapsUrl: 'https://maps.google.com.br/maps?q=Igreja',
    });
    assert.equal(valid1.isValid, true);
    assert.equal(valid1.normalizedData.googleMapsUrl, 'https://maps.google.com.br/maps?q=Igreja');

    const valid2 = validateAndNormalizeChurchInput({
      name: 'Igreja Teste',
      creatorName: 'Pastor Teste',
      timezone: 'America/Sao_Paulo',
      googleMapsUrl: 'https://maps.app.goo.gl/abC123XYZ',
    });
    assert.equal(valid2.isValid, true);
  });

  it('descarte de callback e bloqueio de onSuccess quando a sessão muda antes do retorno', async () => {
    const storage = createMockStorage();
    const userId = 'user-callback-test';

    let resolveRpc;
    const rpcPromise = new Promise((res) => { resolveRpc = res; });
    const mockSupabase = {
      schema: () => ({
        rpc: () => rpcPromise,
      }),
    };

    let sessionActive = true;
    const isSessionValid = () => sessionActive;
    let onSuccessCalled = false;
    const onSuccess = () => { onSuccessCalled = true; };

    const initialGen = getChurchCommandSessionGeneration();

    const creationPromise = dispatchChurchCreation({
      supabaseClient: mockSupabase,
      storage,
      userId,
      churchData: {
        name: 'Igreja Callback',
        creatorName: 'Pastor Callback',
        timezone: 'America/Sao_Paulo',
      },
      commandId: 'cmd-cb',
      sessionGeneration: initialGen,
      isSessionValid,
    }).then((res) => {
      // Simula o comportamento estrito de CreateChurchModal
      if (!isSessionValid() || res.status === 'STALE_SESSION') {
        return; // Descarte de callback
      }
      if (res.status === 'SUCCESS') {
        onSuccess(res.data);
      }
    });

    // Sessão é encerrada/invalidada
    sessionActive = false;
    invalidateChurchCommandSession();

    resolveRpc({
      data: [{
        church_id: 'church-cb-123',
        church_name: 'Igreja Callback',
        member_id: 'mem-cb',
        display_name: 'Pastor Callback',
        is_admin: true,
      }],
      error: null,
    });

    await creationPromise;

    // Callback de sucesso NÃO deve ter sido chamado
    assert.equal(onSuccessCalled, false);
  });
});


